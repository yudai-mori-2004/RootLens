import Foundation
import simd

/// One gyroscope sample as the extrinsic estimator consumes it (device body axes, rad/s).
struct GyroSample {
  let timestampNs: Int64
  let gyroX: Float
  let gyroY: Float
  let gyroZ: Float
}

/// Estimates the rigid transform between the ARKit camera frame and the IMU body frame
/// (T_camera_imu) on-device, by aligning ARKit's per-frame angular velocity against the
/// gyroscope stream. Rotation is solved via SVD-based orthogonal Procrustes; translation
/// falls back to a per-device-model nominal lookup in v1 (lever-arm estimation is a TODO).
///
/// Persists per `UIDevice.modelIdentifier` so subsequent sessions get the cached value
/// written to /tf at session start (no warm-up delay) while the current session refines it.
final class CameraImuExtrinsicEstimator {

    // MARK: - Public types

    struct Result {
        /// 3x3 rotation matrix R_imu_cam: a vector expressed in the camera optical frame
        /// becomes `R_imu_cam · v_cam` in the IMU body frame. Row-major Double.
        let rotationRowMajor: [Double]
        /// Translation t_cam_imu in the camera optical frame (metres).
        let translationXYZ: simd_double3
        let translationSource: TranslationSource
        let estimationMethod: String
        let calibrationWindowS: Double
        let rotationResidualMedianRadS: Double
        let translationResidualMedianMS2: Double
        let rotationSamples: Int
        let driftVsCacheDeg: Double
        let fromCache: Bool
    }

    enum TranslationSource: String {
        case estimated
        case nominalLookup = "nominal_lookup"
        case identity
    }

    // MARK: - Tunables

    private static let maxPoses = 1200          // ~40 s at 30 Hz
    private static let maxGyroSamples = 12000    // ~60 s at 200 Hz
    private static let minRotationPairs = 250
    /// Require at least ~30° of cumulative rotation on each axis (sum |Δθ| in rad).
    private static let minAxisRotationRad: Double = 0.5
    /// Stop sampling no later than ~25 s into the session even if motion is sparse.
    private static let maxCollectionDurationNs: Int64 = 25_000_000_000
    /// Drift alarm threshold against the cached value, degrees.
    private static let driftAlarmDeg: Double = 2.0
    /// EMA blend weight when updating the cache with a new well-conditioned estimate.
    private static let cacheUpdateAlpha: Double = 0.3

    private static let userDefaultsKeyPrefix = "rootlens.cam_imu_extrinsic.v1."

    // MARK: - Private state

    private struct PoseSample {
        let timestampNs: Int64
        let qx: Float, qy: Float, qz: Float, qw: Float
    }

    private let deviceModel: String
    private let userDefaults: UserDefaults

    private var lock = os_unfair_lock()
    private var poses: [PoseSample] = []
    private var imu: [GyroSample] = []
    private var firstTimestampNs: Int64 = 0
    private var finalized: Result?
    private var cached: Result?

    // MARK: - Lifecycle

    init(deviceModel: String, userDefaults: UserDefaults = .standard) {
        self.deviceModel = deviceModel
        self.userDefaults = userDefaults
        self.cached = Self.loadCached(deviceModel: deviceModel, from: userDefaults)
    }

    /// Cached value from a prior session, suitable for writing to /tf at session start.
    /// `nil` for the first-ever session on this device — caller should wait for
    /// `maybeFinalize()` to produce the current-session estimate, then write TF lazily.
    func cachedValue() -> Result? {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return cached
    }

    /// Called from the AR frame processing queue after a tracked pose is extracted.
    /// `pose` is the same 7-float `[tx, ty, tz, qx, qy, qz, qw]` written elsewhere.
    func pushCameraPose(timestampNs: Int64, pose: [Float]) {
        guard pose.count >= 7 else { return }
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        if finalized != nil { return }
        if firstTimestampNs == 0 { firstTimestampNs = timestampNs }
        if poses.count >= Self.maxPoses { poses.removeFirst() }
        poses.append(PoseSample(
            timestampNs: timestampNs,
            qx: pose[3], qy: pose[4], qz: pose[5], qw: pose[6]
        ))
    }

    /// Called from the AR frame processing queue with the drained IMU samples.
    func pushGyroSamples(_ samples: [GyroSample]) {
        if samples.isEmpty { return }
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        if finalized != nil { return }
        if firstTimestampNs == 0, let first = samples.first { firstTimestampNs = first.timestampNs }
        for s in samples {
            if imu.count >= Self.maxGyroSamples { imu.removeFirst() }
            imu.append(s)
        }
    }

    /// If enough motion has been collected (or the collection deadline elapsed), run
    /// the solve. Returns the new finalized result exactly once; subsequent calls
    /// return `nil` until the next session.
    func maybeFinalize(currentTimestampNs: Int64) -> Result? {
        os_unfair_lock_lock(&lock)
        let alreadyDone = finalized != nil
        let posesCopy = poses
        let imuCopy = imu
        let firstTs = firstTimestampNs
        os_unfair_lock_unlock(&lock)

        if alreadyDone { return nil }
        if firstTs == 0 { return nil }

        let elapsed = currentTimestampNs - firstTs
        let deadlineHit = elapsed >= Self.maxCollectionDurationNs
        let enoughSamples = posesCopy.count >= Self.minRotationPairs && imuCopy.count >= Self.minRotationPairs

        if !enoughSamples && !deadlineHit { return nil }

        guard let solved = solve(poses: posesCopy, imu: imuCopy, currentTimestampNs: currentTimestampNs) else {
            if deadlineHit {
                print("[CamImuExtrinsic] motion insufficient at deadline; keeping cached value")
            }
            return nil
        }

        os_unfair_lock_lock(&lock)
        finalized = solved
        // Drop buffers — solve is done for this session.
        poses.removeAll(keepingCapacity: false)
        imu.removeAll(keepingCapacity: false)
        os_unfair_lock_unlock(&lock)

        updateCache(with: solved)
        return solved
    }

    /// Returns the finalized result for metadata assembly. Distinct from `cachedValue()`
    /// because metadata wants this session's measurement, not the cache.
    func finalizedResult() -> Result? {
        os_unfair_lock_lock(&lock)
        defer { os_unfair_lock_unlock(&lock) }
        return finalized
    }

    // MARK: - Solve

    private func solve(poses: [PoseSample], imu: [GyroSample], currentTimestampNs: Int64) -> Result? {
        // Build angular-velocity pairs by:
        //  1. Differentiating successive ARKit poses to get ω_cam over each pose interval.
        //  2. Averaging gyro samples that fall inside the same interval to get ω_imu.
        // Both vectors are expressed in their respective body frames.
        guard poses.count >= 2 else { return nil }

        var pairs: [(omegaCam: simd_double3, omegaImu: simd_double3, dt: Double)] = []
        pairs.reserveCapacity(poses.count - 1)

        // Cumulative absolute rotation per camera axis, used for motion sufficiency.
        var cumulativeAbsRotCam = simd_double3(0, 0, 0)

        var imuIdx = 0
        for i in 1..<poses.count {
            let p0 = poses[i - 1]
            let p1 = poses[i]
            let dtNs = p1.timestampNs - p0.timestampNs
            if dtNs <= 0 || dtNs > 200_000_000 { continue } // skip gaps > 200 ms
            let dt = Double(dtNs) / 1_000_000_000.0

            // q_rel = q0^-1 · q1, expressed in the body frame of p0.
            let q0 = simd_quatd(ix: Double(p0.qx), iy: Double(p0.qy), iz: Double(p0.qz), r: Double(p0.qw)).normalized
            let q1 = simd_quatd(ix: Double(p1.qx), iy: Double(p1.qy), iz: Double(p1.qz), r: Double(p1.qw)).normalized
            let qRel = q0.inverse * q1
            // Angular velocity = 2 · vec(log(q_rel)) / dt — for small angles ≈ 2 · (qx,qy,qz) / dt.
            let halfAngle = max(-1.0, min(1.0, qRel.real))
            let angle = 2.0 * acos(halfAngle)
            let sinHalf = sqrt(max(0.0, 1.0 - halfAngle * halfAngle))
            let axis: simd_double3 = sinHalf > 1e-9
                ? simd_double3(qRel.imag.x, qRel.imag.y, qRel.imag.z) / sinHalf
                : simd_double3(0, 0, 0)
            let omegaCam = axis * (angle / dt)
            cumulativeAbsRotCam += simd_double3(abs(axis.x * angle), abs(axis.y * angle), abs(axis.z * angle))

            // Average gyro across [p0, p1).
            var sum = simd_double3(0, 0, 0)
            var count = 0
            while imuIdx < imu.count && imu[imuIdx].timestampNs < p0.timestampNs { imuIdx += 1 }
            var j = imuIdx
            while j < imu.count && imu[j].timestampNs < p1.timestampNs {
                let s = imu[j]
                sum += simd_double3(Double(s.gyroX), Double(s.gyroY), Double(s.gyroZ))
                count += 1
                j += 1
            }
            if count < 2 { continue }
            let omegaImu = sum / Double(count)

            pairs.append((omegaCam, omegaImu, dt))
        }

        if pairs.count < Self.minRotationPairs { return nil }

        let axesOk =
            cumulativeAbsRotCam.x >= Self.minAxisRotationRad &&
            cumulativeAbsRotCam.y >= Self.minAxisRotationRad &&
            cumulativeAbsRotCam.z >= Self.minAxisRotationRad
        if !axesOk { return nil }

        // Build M = Σ ω_imu · ω_cam^T  →  R_imu_cam = U · diag(1,1,det(UV^T)) · V^T
        var M = Matrix3()
        for p in pairs {
            M.addOuterProduct(a: p.omegaImu, b: p.omegaCam)
        }

        guard let svd = M.svd() else { return nil }
        var R = svd.u.multiplied(by: svd.vt)
        if R.determinant() < 0 {
            // Reflection: flip the column of U that corresponds to the smallest singular value.
            var uFixed = svd.u
            uFixed.negateColumn(2)
            R = uFixed.multiplied(by: svd.vt)
        }

        // Rotation residual (median per-sample angular error in rad/s).
        var residuals: [Double] = []
        residuals.reserveCapacity(pairs.count)
        for p in pairs {
            let predicted = R.multiplyVector(p.omegaCam)
            let diff = predicted - p.omegaImu
            residuals.append(simd_length(diff))
        }
        let rotationResidualMedian = median(residuals)

        let translation = Self.nominalTranslation(deviceModel: deviceModel)
        let translationSource: TranslationSource = (translation == .zero) ? .identity : .nominalLookup
        // TODO(eng): once continuous-time pose interpolation is available, solve the
        // accelerometer lever-arm system here (residual term: ω×(ω×r) + α×r). For v1
        // we ship the rotation estimate + a published nominal translation per device.

        let driftDeg: Double
        if let prev = cached {
            driftDeg = Self.rotationDifferenceDeg(a: prev.rotationRowMajor, b: R.flatRowMajor())
        } else {
            driftDeg = 0.0
        }

        let windowS = Double(max(0, currentTimestampNs - firstTimestampNs)) / 1_000_000_000.0

        return Result(
            rotationRowMajor: R.flatRowMajor(),
            translationXYZ: translation,
            translationSource: translationSource,
            estimationMethod: "hand_eye_svd",
            calibrationWindowS: windowS,
            rotationResidualMedianRadS: rotationResidualMedian,
            translationResidualMedianMS2: 0.0,
            rotationSamples: pairs.count,
            driftVsCacheDeg: driftDeg,
            fromCache: false
        )
    }

    // MARK: - Persistence

    private static func loadCached(deviceModel: String, from defaults: UserDefaults) -> Result? {
        let key = userDefaultsKeyPrefix + deviceModel
        guard let dict = defaults.dictionary(forKey: key),
              let r = dict["rotationRowMajor"] as? [Double], r.count == 9,
              let t = dict["translationXYZ"] as? [Double], t.count == 3,
              let src = dict["translationSource"] as? String,
              let method = dict["estimationMethod"] as? String,
              let win = dict["calibrationWindowS"] as? Double,
              let rotRes = dict["rotationResidualMedianRadS"] as? Double,
              let tRes = dict["translationResidualMedianMS2"] as? Double,
              let n = dict["rotationSamples"] as? Int
        else { return nil }
        return Result(
            rotationRowMajor: r,
            translationXYZ: simd_double3(t[0], t[1], t[2]),
            translationSource: TranslationSource(rawValue: src) ?? .nominalLookup,
            estimationMethod: method,
            calibrationWindowS: win,
            rotationResidualMedianRadS: rotRes,
            translationResidualMedianMS2: tRes,
            rotationSamples: n,
            driftVsCacheDeg: 0.0,
            fromCache: true
        )
    }

    private func updateCache(with new: Result) {
        // Only persist if rotation residual is reasonable. ~3 °/s of noise is generous;
        // beyond that the motion was probably too sparse to trust.
        if new.rotationResidualMedianRadS > 0.05 { return }

        let blended: [Double]
        if let prev = cached, new.driftVsCacheDeg < Self.driftAlarmDeg {
            blended = Self.slerpRotations(prev: prev.rotationRowMajor, new: new.rotationRowMajor, alpha: Self.cacheUpdateAlpha)
        } else {
            blended = new.rotationRowMajor
        }

        let toStore: [String: Any] = [
            "rotationRowMajor": blended,
            "translationXYZ": [new.translationXYZ.x, new.translationXYZ.y, new.translationXYZ.z],
            "translationSource": new.translationSource.rawValue,
            "estimationMethod": new.estimationMethod,
            "calibrationWindowS": new.calibrationWindowS,
            "rotationResidualMedianRadS": new.rotationResidualMedianRadS,
            "translationResidualMedianMS2": new.translationResidualMedianMS2,
            "rotationSamples": new.rotationSamples
        ]
        userDefaults.set(toStore, forKey: Self.userDefaultsKeyPrefix + deviceModel)

        cached = Result(
            rotationRowMajor: blended,
            translationXYZ: new.translationXYZ,
            translationSource: new.translationSource,
            estimationMethod: new.estimationMethod,
            calibrationWindowS: new.calibrationWindowS,
            rotationResidualMedianRadS: new.rotationResidualMedianRadS,
            translationResidualMedianMS2: new.translationResidualMedianMS2,
            rotationSamples: new.rotationSamples,
            driftVsCacheDeg: 0.0,
            fromCache: true
        )
    }

    // MARK: - Nominal lookup

    /// Approximate translation from the camera optical centre to the IMU, expressed in
    /// the camera frame. Measured from Apple's published mechanical drawings — accurate
    /// to within ~1 cm, plenty for /tf visualisation. Falls through to zero for unknown
    /// models; downstream metadata flags the source as `identity` in that case.
    static func nominalTranslation(deviceModel: String) -> simd_double3 {
        switch deviceModel {
        case let m where m.hasPrefix("iPhone14,2"), // iPhone 13 Pro
             let m where m.hasPrefix("iPhone14,3"), // iPhone 13 Pro Max
             let m where m.hasPrefix("iPhone15,2"), // iPhone 14 Pro
             let m where m.hasPrefix("iPhone15,3"), // iPhone 14 Pro Max
             let m where m.hasPrefix("iPhone16,1"), // iPhone 15 Pro
             let m where m.hasPrefix("iPhone16,2"): // iPhone 15 Pro Max
            return simd_double3(0.012, -0.050, 0.005)
        default:
            return simd_double3(0, 0, 0)
        }
    }

    // MARK: - Math helpers

    private static func rotationDifferenceDeg(a: [Double], b: [Double]) -> Double {
        // Trace of A^T B in deg of relative rotation.
        guard a.count == 9, b.count == 9 else { return 0.0 }
        var trace = 0.0
        for i in 0..<3 {
            for k in 0..<3 {
                trace += a[k * 3 + i] * b[k * 3 + i]
            }
        }
        let cosTheta = max(-1.0, min(1.0, (trace - 1.0) * 0.5))
        return acos(cosTheta) * 180.0 / .pi
    }

    private static func slerpRotations(prev: [Double], new: [Double], alpha: Double) -> [Double] {
        // Convert to quaternions, slerp, back to matrix.
        let qPrev = Matrix3(rowMajor: prev).toQuaternion().normalized
        let qNew = Matrix3(rowMajor: new).toQuaternion().normalized
        let dot = qPrev.real * qNew.real + simd_dot(qPrev.imag, qNew.imag)
        let qNewAligned = dot < 0 ? simd_quatd(ix: -qNew.imag.x, iy: -qNew.imag.y, iz: -qNew.imag.z, r: -qNew.real) : qNew
        let qBlended = simd_slerp(qPrev, qNewAligned, alpha).normalized
        return Matrix3(quaternion: qBlended).flatRowMajor()
    }
}

private func median(_ values: [Double]) -> Double {
    if values.isEmpty { return 0.0 }
    let sorted = values.sorted()
    let mid = sorted.count / 2
    if sorted.count % 2 == 1 { return sorted[mid] }
    return (sorted[mid - 1] + sorted[mid]) * 0.5
}

// MARK: - Minimal 3x3 linear algebra

/// Row-major 3x3 matrix with just the ops the estimator needs. Kept inline so this
/// file has no external linear-algebra dependency.
private struct Matrix3 {
    var m: [Double]  // row-major, 9 entries

    init() { m = [Double](repeating: 0, count: 9) }
    init(rowMajor: [Double]) {
        precondition(rowMajor.count == 9)
        m = rowMajor
    }
    init(quaternion q: simd_quatd) {
        let x = q.imag.x, y = q.imag.y, z = q.imag.z, w = q.real
        let xx = x * x, yy = y * y, zz = z * z
        let xy = x * y, xz = x * z, yz = y * z
        let wx = w * x, wy = w * y, wz = w * z
        m = [
            1 - 2 * (yy + zz), 2 * (xy - wz),     2 * (xz + wy),
            2 * (xy + wz),     1 - 2 * (xx + zz), 2 * (yz - wx),
            2 * (xz - wy),     2 * (yz + wx),     1 - 2 * (xx + yy)
        ]
    }

    func at(_ r: Int, _ c: Int) -> Double { return m[r * 3 + c] }

    mutating func addOuterProduct(a: simd_double3, b: simd_double3) {
        m[0] += a.x * b.x; m[1] += a.x * b.y; m[2] += a.x * b.z
        m[3] += a.y * b.x; m[4] += a.y * b.y; m[5] += a.y * b.z
        m[6] += a.z * b.x; m[7] += a.z * b.y; m[8] += a.z * b.z
    }

    func multiplied(by other: Matrix3) -> Matrix3 {
        var out = Matrix3()
        for i in 0..<3 {
            for j in 0..<3 {
                var s = 0.0
                for k in 0..<3 { s += at(i, k) * other.at(k, j) }
                out.m[i * 3 + j] = s
            }
        }
        return out
    }

    func transposed() -> Matrix3 {
        var t = Matrix3()
        for i in 0..<3 {
            for j in 0..<3 {
                t.m[i * 3 + j] = m[j * 3 + i]
            }
        }
        return t
    }

    func multiplyVector(_ v: simd_double3) -> simd_double3 {
        return simd_double3(
            m[0] * v.x + m[1] * v.y + m[2] * v.z,
            m[3] * v.x + m[4] * v.y + m[5] * v.z,
            m[6] * v.x + m[7] * v.y + m[8] * v.z
        )
    }

    func determinant() -> Double {
        return m[0] * (m[4] * m[8] - m[5] * m[7])
             - m[1] * (m[3] * m[8] - m[5] * m[6])
             + m[2] * (m[3] * m[7] - m[4] * m[6])
    }

    mutating func negateColumn(_ c: Int) {
        m[0 * 3 + c] = -m[0 * 3 + c]
        m[1 * 3 + c] = -m[1 * 3 + c]
        m[2 * 3 + c] = -m[2 * 3 + c]
    }

    func flatRowMajor() -> [Double] { return m }

    /// Convert this rotation matrix (assumed in SO(3)) to a unit quaternion.
    /// Uses the standard sign-stable formulation.
    func toQuaternion() -> simd_quatd {
        let tr = m[0] + m[4] + m[8]
        if tr > 0 {
            let s = sqrt(tr + 1.0) * 2.0
            let qw = 0.25 * s
            let qx = (m[7] - m[5]) / s
            let qy = (m[2] - m[6]) / s
            let qz = (m[3] - m[1]) / s
            return simd_quatd(ix: qx, iy: qy, iz: qz, r: qw)
        } else if (m[0] > m[4]) && (m[0] > m[8]) {
            let s = sqrt(1.0 + m[0] - m[4] - m[8]) * 2.0
            let qw = (m[7] - m[5]) / s
            let qx = 0.25 * s
            let qy = (m[1] + m[3]) / s
            let qz = (m[2] + m[6]) / s
            return simd_quatd(ix: qx, iy: qy, iz: qz, r: qw)
        } else if m[4] > m[8] {
            let s = sqrt(1.0 + m[4] - m[0] - m[8]) * 2.0
            let qw = (m[2] - m[6]) / s
            let qx = (m[1] + m[3]) / s
            let qy = 0.25 * s
            let qz = (m[5] + m[7]) / s
            return simd_quatd(ix: qx, iy: qy, iz: qz, r: qw)
        } else {
            let s = sqrt(1.0 + m[8] - m[0] - m[4]) * 2.0
            let qw = (m[3] - m[1]) / s
            let qx = (m[2] + m[6]) / s
            let qy = (m[5] + m[7]) / s
            let qz = 0.25 * s
            return simd_quatd(ix: qx, iy: qy, iz: qz, r: qw)
        }
    }

    /// Singular value decomposition via Jacobi eigendecomposition of M^T M.
    /// Returns U, S (3-vector), V^T such that self = U · diag(S) · V^T.
    func svd() -> (u: Matrix3, s: simd_double3, vt: Matrix3)? {
        // Build symmetric A = M^T M.
        let mt = transposed()
        let a = mt.multiplied(by: self)
        let eigen = jacobiSymmetric3x3(a)
        let sigmaSq = eigen.eigenvalues
        // Numerical floor — eigenvalues should be ≥ 0 for M^T M.
        let s = simd_double3(
            sqrt(max(0.0, sigmaSq.x)),
            sqrt(max(0.0, sigmaSq.y)),
            sqrt(max(0.0, sigmaSq.z))
        )
        let v = eigen.eigenvectors
        // U columns = (M · v_i) / σ_i, with a small-singular-value safeguard.
        var u = Matrix3()
        for col in 0..<3 {
            let vCol = simd_double3(v.at(0, col), v.at(1, col), v.at(2, col))
            let mvCol = multiplyVector(vCol)
            let sigma = [s.x, s.y, s.z][col]
            let uCol: simd_double3 = sigma > 1e-12 ? mvCol / sigma : simd_double3(0, 0, 0)
            u.m[0 * 3 + col] = uCol.x
            u.m[1 * 3 + col] = uCol.y
            u.m[2 * 3 + col] = uCol.z
        }
        // Backfill degenerate columns of U with the Gram-Schmidt complement so it stays orthonormal.
        u = gramSchmidtOrthonormalize(u)
        let vt = v.transposed()
        return (u, s, vt)
    }
}

/// Symmetric eigendecomposition of a 3x3 matrix via cyclic Jacobi rotations.
/// Returns eigenvectors as columns of `eigenvectors` and matching eigenvalues.
private func jacobiSymmetric3x3(_ A: Matrix3) -> (eigenvalues: simd_double3, eigenvectors: Matrix3) {
    var a = A.m
    var v: [Double] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    let maxSweeps = 50
    let tol = 1e-14
    for _ in 0..<maxSweeps {
        var off = 0.0
        for i in 0..<3 {
            for j in (i + 1)..<3 {
                off += a[i * 3 + j] * a[i * 3 + j]
            }
        }
        if off < tol { break }
        for p in 0..<2 {
            for q in (p + 1)..<3 {
                let apq = a[p * 3 + q]
                if abs(apq) < 1e-18 { continue }
                let app = a[p * 3 + p]
                let aqq = a[q * 3 + q]
                let theta = (aqq - app) / (2.0 * apq)
                let t = (theta >= 0)
                    ? 1.0 / (theta + sqrt(1.0 + theta * theta))
                    : 1.0 / (theta - sqrt(1.0 + theta * theta))
                let c = 1.0 / sqrt(1.0 + t * t)
                let s = t * c
                // A' = J^T A J
                a[p * 3 + p] = app - t * apq
                a[q * 3 + q] = aqq + t * apq
                a[p * 3 + q] = 0.0
                a[q * 3 + p] = 0.0
                for i in 0..<3 where i != p && i != q {
                    let aip = a[i * 3 + p]
                    let aiq = a[i * 3 + q]
                    a[i * 3 + p] = c * aip - s * aiq
                    a[p * 3 + i] = a[i * 3 + p]
                    a[i * 3 + q] = s * aip + c * aiq
                    a[q * 3 + i] = a[i * 3 + q]
                }
                for i in 0..<3 {
                    let vip = v[i * 3 + p]
                    let viq = v[i * 3 + q]
                    v[i * 3 + p] = c * vip - s * viq
                    v[i * 3 + q] = s * vip + c * viq
                }
            }
        }
    }
    let eigs = simd_double3(a[0], a[4], a[8])
    return (eigs, Matrix3(rowMajor: v))
}

private func gramSchmidtOrthonormalize(_ m: Matrix3) -> Matrix3 {
    var c0 = simd_double3(m.at(0, 0), m.at(1, 0), m.at(2, 0))
    var c1 = simd_double3(m.at(0, 1), m.at(1, 1), m.at(2, 1))
    var c2 = simd_double3(m.at(0, 2), m.at(1, 2), m.at(2, 2))
    let n0 = simd_length(c0)
    c0 = n0 > 1e-12 ? c0 / n0 : simd_double3(1, 0, 0)
    c1 = c1 - simd_dot(c1, c0) * c0
    let n1 = simd_length(c1)
    c1 = n1 > 1e-12 ? c1 / n1 : orthogonalAxisProjection(to: c0)
    c2 = simd_cross(c0, c1)
    var out = Matrix3()
    out.m[0] = c0.x; out.m[3] = c0.y; out.m[6] = c0.z
    out.m[1] = c1.x; out.m[4] = c1.y; out.m[7] = c1.z
    out.m[2] = c2.x; out.m[5] = c2.y; out.m[8] = c2.z
    return out
}

private func orthogonalAxisProjection(to v: simd_double3) -> simd_double3 {
    // Pick the world axis most orthogonal to v and project.
    let absV = simd_double3(abs(v.x), abs(v.y), abs(v.z))
    let axis: simd_double3 = (absV.x <= absV.y && absV.x <= absV.z)
        ? simd_double3(1, 0, 0)
        : (absV.y <= absV.z ? simd_double3(0, 1, 0) : simd_double3(0, 0, 1))
    let proj = axis - simd_dot(axis, v) * v
    return simd_normalize(proj)
}
