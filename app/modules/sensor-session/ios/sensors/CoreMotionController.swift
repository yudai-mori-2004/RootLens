import CoreMotion
import Foundation

// CoreMotion を Process 内で 1 個だけ持つ singleton。
// 各 ISensor (Accel / Gyro / Mag / DeviceMotion / Altimeter) はここに登録された
// CMMotionManager / CMAltimeter のストリームに subscribe する。
//
// 設計:
//   - 各ストリームは独立にリングバッファに蓄積する。常時稼働 (capture 待ち間も)
//   - capture(window) 時点で window 範囲内の sample を切り出して返す
//   - update interval はデフォルト 100Hz。Phase 5 で機種能力 + 権限に応じて引き上げ可
//
// 思想 (Don't be the judge):
//   - "raw" / "fused" の判定は持たない。CMMotionManager の各 API が独立に存在する事実を
//     そのまま 5 つの ISensor として表現する

// MARK: - Sample types

struct AccelSample: TimedSample {
  let timestampNs: UInt64
  let x: Double
  let y: Double
  let z: Double
}

struct GyroSample: TimedSample {
  let timestampNs: UInt64
  let x: Double  // rad/s
  let y: Double
  let z: Double
}

struct MagSample: TimedSample {
  let timestampNs: UInt64
  let x: Double  // microtesla
  let y: Double
  let z: Double
}

struct DeviceMotionSample: TimedSample {
  let timestampNs: UInt64
  // attitude (quaternion)
  let qx: Double
  let qy: Double
  let qz: Double
  let qw: Double
  // user acceleration (gravity excluded)
  let userAx: Double
  let userAy: Double
  let userAz: Double
  // gravity
  let gx: Double
  let gy: Double
  let gz: Double
  // rotation rate (gyro after bias removal)
  let rx: Double
  let ry: Double
  let rz: Double
  // magnetic field (if available + calibrated)
  let mx: Double?
  let my: Double?
  let mz: Double?
  let mAccuracy: Int?
}

struct AltitudeSample: TimedSample {
  let timestampNs: UInt64
  let pressure: Double  // kPa
  let relativeAltitude: Double  // meters
}

// MARK: - Controller

final class CoreMotionController {
  static let shared = CoreMotionController()

  let motionManager = CMMotionManager()
  let altimeter = CMAltimeter()
  private let motionQueue: OperationQueue

  let accelBuffer = SampleRingBuffer<AccelSample>()
  let gyroBuffer = SampleRingBuffer<GyroSample>()
  let magBuffer = SampleRingBuffer<MagSample>()
  let deviceMotionBuffer = SampleRingBuffer<DeviceMotionSample>()
  let altitudeBuffer = SampleRingBuffer<AltitudeSample>()

  // 既定サンプリング周期 (sec)。100Hz 相当。
  private let defaultIntervalSec: TimeInterval = 1.0 / 100.0

  private init() {
    motionQueue = OperationQueue()
    motionQueue.name = "io.rootlens.sensor-session.coremotion"
    motionQueue.qualityOfService = .userInitiated
  }

  // MARK: - Lifecycle (idempotent)

  func startAccelerometerIfAvailable() {
    guard motionManager.isAccelerometerAvailable, !motionManager.isAccelerometerActive else { return }
    motionManager.accelerometerUpdateInterval = defaultIntervalSec
    motionManager.startAccelerometerUpdates(to: motionQueue) { [weak self] data, _ in
      guard let self = self, let d = data else { return }
      self.accelBuffer.push(AccelSample(
        timestampNs: UInt64(d.timestamp * 1_000_000_000),
        x: d.acceleration.x,
        y: d.acceleration.y,
        z: d.acceleration.z
      ))
    }
  }

  func startGyroIfAvailable() {
    guard motionManager.isGyroAvailable, !motionManager.isGyroActive else { return }
    motionManager.gyroUpdateInterval = defaultIntervalSec
    motionManager.startGyroUpdates(to: motionQueue) { [weak self] data, _ in
      guard let self = self, let d = data else { return }
      self.gyroBuffer.push(GyroSample(
        timestampNs: UInt64(d.timestamp * 1_000_000_000),
        x: d.rotationRate.x,
        y: d.rotationRate.y,
        z: d.rotationRate.z
      ))
    }
  }

  func startMagnetometerIfAvailable() {
    guard motionManager.isMagnetometerAvailable, !motionManager.isMagnetometerActive else { return }
    motionManager.magnetometerUpdateInterval = defaultIntervalSec
    motionManager.startMagnetometerUpdates(to: motionQueue) { [weak self] data, _ in
      guard let self = self, let d = data else { return }
      self.magBuffer.push(MagSample(
        timestampNs: UInt64(d.timestamp * 1_000_000_000),
        x: d.magneticField.x,
        y: d.magneticField.y,
        z: d.magneticField.z
      ))
    }
  }

  func startDeviceMotionIfAvailable() {
    guard motionManager.isDeviceMotionAvailable, !motionManager.isDeviceMotionActive else { return }
    motionManager.deviceMotionUpdateInterval = defaultIntervalSec
    motionManager.startDeviceMotionUpdates(
      using: .xMagneticNorthZVertical,
      to: motionQueue
    ) { [weak self] data, _ in
      guard let self = self, let d = data else { return }
      let q = d.attitude.quaternion
      let mag = d.magneticField
      self.deviceMotionBuffer.push(DeviceMotionSample(
        timestampNs: UInt64(d.timestamp * 1_000_000_000),
        qx: q.x, qy: q.y, qz: q.z, qw: q.w,
        userAx: d.userAcceleration.x,
        userAy: d.userAcceleration.y,
        userAz: d.userAcceleration.z,
        gx: d.gravity.x, gy: d.gravity.y, gz: d.gravity.z,
        rx: d.rotationRate.x, ry: d.rotationRate.y, rz: d.rotationRate.z,
        mx: mag.field.x.isFinite ? mag.field.x : nil,
        my: mag.field.y.isFinite ? mag.field.y : nil,
        mz: mag.field.z.isFinite ? mag.field.z : nil,
        mAccuracy: Int(mag.accuracy.rawValue)
      ))
    }
  }

  func startAltimeterIfAvailable() {
    guard CMAltimeter.isRelativeAltitudeAvailable() else { return }
    altimeter.startRelativeAltitudeUpdates(to: motionQueue) { [weak self] data, _ in
      guard let self = self, let d = data else { return }
      self.altitudeBuffer.push(AltitudeSample(
        timestampNs: UInt64(d.timestamp * 1_000_000_000),
        pressure: d.pressure.doubleValue,
        relativeAltitude: d.relativeAltitude.doubleValue
      ))
    }
  }

  /// すべての利用可能なストリームを開始する (idempotent)
  func startAllAvailable() {
    startAccelerometerIfAvailable()
    startGyroIfAvailable()
    startMagnetometerIfAvailable()
    startDeviceMotionIfAvailable()
    startAltimeterIfAvailable()
  }

  // MARK: - Window slicing

  /// anchor (monotonic ns) を基準に lookback / duration を展開して slice 範囲を返す。
  /// CMLogItem.timestamp と同軸の monotonic ns 軸で動作する (JS-side の wall-clock startNs は使わない)。
  static func windowRangeNs(_ window: SensorTimeWindow) -> (start: UInt64, end: UInt64) {
    let lookbackNs = UInt64(max(0, window.lookbackMs)) * 1_000_000
    let durationNs = UInt64(max(0, window.durationMs)) * 1_000_000
    let anchor = window.anchorMonotonicNs
    let startNs = anchor > lookbackNs ? anchor - lookbackNs : 0
    let endNs = anchor + durationNs
    return (startNs, endNs)
  }
}
