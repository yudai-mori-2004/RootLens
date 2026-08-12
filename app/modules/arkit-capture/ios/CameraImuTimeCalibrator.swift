import AVFoundation
import CoreVideo
import Foundation
import Vision

/// Measures the residual offset between the timestamps attached to recorded camera
/// images and `CMDeviceMotion.timestamp`. Capture itself goes through the production
/// recorder; this analyzer runs only after the temporary clip has closed. ARKit pose
/// is deliberately not used because it is already the output of a visual-inertial
/// estimator.
///
/// Sign convention:
///   physical image motion at video timestamp `t` matches IMU samples at
///   `t + videoToImuOffsetMs`.
final class CameraImuTimeCalibrator {

  struct Estimate {
    let videoToImuOffsetMs: Double
    let standardDeviationMs: Double
    let rangeMinMs: Double
    let rangeMaxMs: Double
    let peakCorrelation: Double
    let visualSampleCount: Int
    let gyroSampleCount: Int
    let windowCount: Int
    let durationSeconds: Double
    let quality: String
  }

  enum CalibrationError: LocalizedError {
    case invalidRecording(String)
    case videoDecode(String)
    case insufficientVisualSamples(Int)
    case insufficientMotion
    case weakCorrelation(Double)

    var errorDescription: String? {
      switch self {
      case .invalidRecording(let message):
        return "Invalid RGB-IMU validation recording: \(message)"
      case .videoDecode(let message):
        return "Could not decode the RGB-IMU validation video: \(message)"
      case .insufficientVisualSamples(let count):
        return "Not enough usable image-motion samples (\(count)); keep a textured, stationary scene in view"
      case .insufficientMotion:
        return "Motion was insufficient; rotate the device left/right and up/down with varied speed"
      case .weakCorrelation(let value):
        return String(format: "Image motion and gyroscope did not correlate reliably (%.2f); retry in brighter light", value)
      }
    }
  }

  private struct VisualInterval {
    let startTimestampNs: Int64
    let endTimestampNs: Int64
    let normalizedSpeed: Double
  }

  private struct GyroPoint {
    let timestampNs: Int64
    let magnitude: Double
  }

  private struct CorrelationPeak {
    let offsetMs: Double
    let correlation: Double
  }

  private var previousFrame: (buffer: CVPixelBuffer, timestampNs: Int64)?
  private var visual: [VisualInterval] = []

  /// Analyze a temporary clip produced by the normal RootLens recorder. The MP4
  /// and frames.jsonl have a strict 1:1 frame contract, so decoded frame index i
  /// receives the acquisition timestamp from frames row i.
  static func analyzeRecording(at sessionDir: URL) throws -> Estimate {
    let frameTimestamps = try readFrameTimestamps(
      from: sessionDir.appendingPathComponent("frames.jsonl"))
    let gyro = try readGyro(from: sessionDir.appendingPathComponent("imu.jsonl"))
    guard frameTimestamps.count >= 60 else {
      throw CalibrationError.insufficientVisualSamples(frameTimestamps.count)
    }
    guard gyro.count >= 300 else { throw CalibrationError.insufficientMotion }

    let videoURL = sessionDir.appendingPathComponent("rgb.mp4")
    guard FileManager.default.fileExists(atPath: videoURL.path) else {
      throw CalibrationError.invalidRecording("rgb.mp4 is missing")
    }
    let asset = AVURLAsset(url: videoURL)
    guard let track = asset.tracks(withMediaType: .video).first else {
      throw CalibrationError.invalidRecording("rgb.mp4 has no video track")
    }
    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: asset)
    } catch {
      throw CalibrationError.videoDecode(error.localizedDescription)
    }
    let output = AVAssetReaderTrackOutput(
      track: track,
      outputSettings: [
        kCVPixelBufferPixelFormatTypeKey as String:
          Int(kCVPixelFormatType_420YpCbCr8BiPlanarFullRange),
      ])
    output.alwaysCopiesSampleData = false
    guard reader.canAdd(output) else {
      throw CalibrationError.videoDecode("AVAssetReader rejected the video output")
    }
    reader.add(output)
    guard reader.startReading() else {
      throw CalibrationError.videoDecode(reader.error?.localizedDescription ?? "reader did not start")
    }

    let analyzer = CameraImuTimeCalibrator()
    var frameIndex = 0
    var analyzedFrames = 0
    var lastAnalyzedTimestampNs: Int64 = 0
    let minimumFrameSpacingNs: Int64 = 45_000_000 // at most ~20 registrations/s
    while let sample = output.copyNextSampleBuffer() {
      guard frameIndex < frameTimestamps.count else { break }
      let timestampNs = frameTimestamps[frameIndex]
      frameIndex += 1
      if lastAnalyzedTimestampNs != 0,
         timestampNs - lastAnalyzedTimestampNs < minimumFrameSpacingNs {
        continue
      }
      guard let buffer = CMSampleBufferGetImageBuffer(sample) else { continue }
      analyzer.processFrame(buffer, timestampNs: timestampNs)
      lastAnalyzedTimestampNs = timestampNs
      analyzedFrames += 1
    }
    if reader.status == .failed {
      throw CalibrationError.videoDecode(reader.error?.localizedDescription ?? "reader failed")
    }
    guard analyzedFrames >= 60 else {
      throw CalibrationError.insufficientVisualSamples(analyzedFrames)
    }
    return try solve(visual: analyzer.visual, gyro: gyro)
  }

  private static func readFrameTimestamps(from url: URL) throws -> [Int64] {
    let rows = try readJsonLines(from: url)
    let timestamps = rows.compactMap { ($0["timestamp_ns"] as? NSNumber)?.int64Value }
    guard timestamps.count == rows.count else {
      throw CalibrationError.invalidRecording("frames.jsonl contains a row without timestamp_ns")
    }
    return timestamps
  }

  private static func readGyro(from url: URL) throws -> [GyroPoint] {
    let rows = try readJsonLines(from: url)
    return rows.compactMap { row in
      guard let timestamp = (row["timestamp_ns"] as? NSNumber)?.int64Value,
            let gyro = row["gyro"] as? [String: Any],
            let x = (gyro["x"] as? NSNumber)?.doubleValue,
            let y = (gyro["y"] as? NSNumber)?.doubleValue,
            let z = (gyro["z"] as? NSNumber)?.doubleValue else { return nil }
      let magnitude = sqrt(x * x + y * y + z * z)
      return magnitude.isFinite ? GyroPoint(timestampNs: timestamp, magnitude: magnitude) : nil
    }
  }

  private static func readJsonLines(from url: URL) throws -> [[String: Any]] {
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw CalibrationError.invalidRecording("\(url.lastPathComponent) is missing")
    }
    let data = try Data(contentsOf: url)
    return try data.split(separator: 0x0A).map { line in
      guard let row = try JSONSerialization.jsonObject(with: Data(line)) as? [String: Any] else {
        throw CalibrationError.invalidRecording("\(url.lastPathComponent) contains a non-object row")
      }
      return row
    }
  }

  private func processFrame(_ current: CVPixelBuffer, timestampNs: Int64) {
    defer { previousFrame = (current, timestampNs) }
    guard let previous = previousFrame else { return }

    let dtNs = timestampNs - previous.timestampNs
    guard dtNs >= 25_000_000, dtNs <= 300_000_000 else { return }

    do {
      // The targeted buffer is the floating image; Vision estimates the
      // translation that maps it onto the handler's reference image.
      let request = VNTranslationalImageRegistrationRequest(
        targetedCVPixelBuffer: previous.buffer,
        options: [:])
      let handler = VNImageRequestHandler(cvPixelBuffer: current, options: [:])
      try handler.perform([request])
      guard let observation = request.results?.first else { return }
      let transform = observation.alignmentTransform
      let displacement = hypot(Double(transform.tx), Double(transform.ty))
      let width = Double(CVPixelBufferGetWidth(current))
      let height = Double(CVPixelBufferGetHeight(current))
      let diagonal = hypot(width, height)
      guard diagonal > 0,
            displacement.isFinite,
            displacement <= diagonal * 0.35 else { return }

      let dt = Double(dtNs) / 1_000_000_000.0
      let normalizedSpeed = displacement / diagonal / dt
      guard normalizedSpeed.isFinite else { return }
      visual.append(VisualInterval(
        startTimestampNs: previous.timestampNs,
        endTimestampNs: timestampNs,
        normalizedSpeed: normalizedSpeed))
    } catch {
      // A single registration failure is normal under blur or feature-poor
      // frames. The sample is dropped; the final sample/quality gates decide
      // whether the overall run is usable.
    }
  }

  // MARK: - Temporal solve

  private static func solve(visual rawVisual: [VisualInterval], gyro rawGyro: [GyroPoint]) throws -> Estimate {
    guard rawVisual.count >= 60 else {
      throw CalibrationError.insufficientVisualSamples(rawVisual.count)
    }
    let gyro = rawGyro.sorted { $0.timestampNs < $1.timestampNs }
    guard gyro.count >= 300 else { throw CalibrationError.insufficientMotion }

    // Reject isolated registration failures without suppressing legitimate fast
    // turns. A wide MAD fence preserves the peaks that make the delay observable.
    let speeds = rawVisual.map(\.normalizedSpeed)
    let speedMedian = median(speeds)
    let speedMad = median(speeds.map { abs($0 - speedMedian) })
    let speedCeiling = speedMedian + max(12.0 * speedMad, 0.15)
    let visual = rawVisual.filter {
      $0.normalizedSpeed >= 0 && $0.normalizedSpeed <= speedCeiling
    }
    guard visual.count >= 60 else {
      throw CalibrationError.insufficientVisualSamples(visual.count)
    }

    let visualStd = standardDeviation(visual.map(\.normalizedSpeed))
    let gyroStd = standardDeviation(gyro.map(\.magnitude))
    let gyroPeak = gyro.map(\.magnitude).max() ?? 0
    guard visualStd >= 0.003, gyroStd >= 0.08, gyroPeak >= 0.45 else {
      throw CalibrationError.insufficientMotion
    }

    let prefix = gyro.reduce(into: [0.0]) { partial, point in
      partial.append(partial.last! + point.magnitude)
    }
    guard let globalPeak = bestOffset(visual: visual, gyro: gyro, gyroPrefix: prefix) else {
      throw CalibrationError.weakCorrelation(0)
    }
    guard globalPeak.correlation >= 0.30 else {
      throw CalibrationError.weakCorrelation(globalPeak.correlation)
    }

    // Estimate repeatability from independent time windows within the run. This
    // is what the UI reports as sigma/range; it is more useful than the numerical
    // grid resolution of the global optimizer.
    let firstTs = visual.first!.startTimestampNs
    let lastTs = visual.last!.endTimestampNs
    let span = max(Int64(1), lastTs - firstTs)
    var windowOffsets: [Double] = []
    let requestedWindows = 5
    for window in 0..<requestedWindows {
      let lo = firstTs + span * Int64(window) / Int64(requestedWindows)
      let hi = firstTs + span * Int64(window + 1) / Int64(requestedWindows)
      let subset = visual.filter {
        let mid = $0.startTimestampNs + ($0.endTimestampNs - $0.startTimestampNs) / 2
        return mid >= lo && mid < hi
      }
      guard subset.count >= 12,
            standardDeviation(subset.map(\.normalizedSpeed)) >= 0.002,
            let peak = bestOffset(visual: subset, gyro: gyro, gyroPrefix: prefix),
            peak.correlation >= 0.25 else { continue }
      windowOffsets.append(peak.offsetMs)
    }

    let sigma = windowOffsets.count >= 2 ? standardDeviation(windowOffsets) : 0.0
    let rangeMin = windowOffsets.min() ?? globalPeak.offsetMs
    let rangeMax = windowOffsets.max() ?? globalPeak.offsetMs
    let quality = globalPeak.correlation >= 0.55 && windowOffsets.count >= 3 && sigma <= 8.0
      ? "good" : "review"

    return Estimate(
      videoToImuOffsetMs: globalPeak.offsetMs,
      standardDeviationMs: sigma,
      rangeMinMs: rangeMin,
      rangeMaxMs: rangeMax,
      peakCorrelation: globalPeak.correlation,
      visualSampleCount: visual.count,
      gyroSampleCount: gyro.count,
      windowCount: windowOffsets.count,
      durationSeconds: Double(span) / 1_000_000_000.0,
      quality: quality)
  }

  /// Searches the delay that makes image-motion speed over each frame interval
  /// best match mean gyroscope magnitude over the shifted interval.
  private static func bestOffset(
    visual: [VisualInterval],
    gyro: [GyroPoint],
    gyroPrefix: [Double]
  ) -> CorrelationPeak? {
    let minOffsetMs = -150.0
    let maxOffsetMs = 150.0
    let stepMs = 0.5
    let count = Int(((maxOffsetMs - minOffsetMs) / stepMs).rounded()) + 1
    var correlations = [Double](repeating: -.infinity, count: count)

    for index in 0..<count {
      let offsetMs = minOffsetMs + Double(index) * stepMs
      let offsetNs = Int64((offsetMs * 1_000_000.0).rounded())
      var imageValues: [Double] = []
      var imuValues: [Double] = []
      imageValues.reserveCapacity(visual.count)
      imuValues.reserveCapacity(visual.count)

      for sample in visual {
        let start = sample.startTimestampNs + offsetNs
        let end = sample.endTimestampNs + offsetNs
        let lo = lowerBound(gyro, timestampNs: start)
        let hi = lowerBound(gyro, timestampNs: end)
        guard hi > lo else { continue }
        let meanGyro = (gyroPrefix[hi] - gyroPrefix[lo]) / Double(hi - lo)
        imageValues.append(sample.normalizedSpeed)
        imuValues.append(meanGyro)
      }
      if imageValues.count >= 20 {
        correlations[index] = pearson(imageValues, imuValues)
      }
    }

    guard let bestIndex = correlations.indices.max(by: { correlations[$0] < correlations[$1] }),
          correlations[bestIndex].isFinite else { return nil }

    var refinedIndex = Double(bestIndex)
    if bestIndex > 0, bestIndex + 1 < correlations.count {
      let left = correlations[bestIndex - 1]
      let center = correlations[bestIndex]
      let right = correlations[bestIndex + 1]
      let denominator = left - 2.0 * center + right
      if left.isFinite, right.isFinite, abs(denominator) > 1e-12 {
        let delta = 0.5 * (left - right) / denominator
        refinedIndex += max(-1.0, min(1.0, delta))
      }
    }
    return CorrelationPeak(
      offsetMs: minOffsetMs + refinedIndex * stepMs,
      correlation: correlations[bestIndex])
  }

  private static func lowerBound(_ points: [GyroPoint], timestampNs: Int64) -> Int {
    var lo = 0
    var hi = points.count
    while lo < hi {
      let mid = lo + (hi - lo) / 2
      if points[mid].timestampNs < timestampNs { lo = mid + 1 } else { hi = mid }
    }
    return lo
  }

  private static func pearson(_ a: [Double], _ b: [Double]) -> Double {
    guard a.count == b.count, a.count >= 2 else { return -.infinity }
    let meanA = a.reduce(0, +) / Double(a.count)
    let meanB = b.reduce(0, +) / Double(b.count)
    var numerator = 0.0
    var denomA = 0.0
    var denomB = 0.0
    for i in a.indices {
      let da = a[i] - meanA
      let db = b[i] - meanB
      numerator += da * db
      denomA += da * da
      denomB += db * db
    }
    let denominator = sqrt(denomA * denomB)
    return denominator > 1e-15 ? numerator / denominator : -.infinity
  }
}

private func median(_ values: [Double]) -> Double {
  guard !values.isEmpty else { return 0 }
  let sorted = values.sorted()
  let middle = sorted.count / 2
  return sorted.count.isMultiple(of: 2)
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle]
}

private func standardDeviation(_ values: [Double]) -> Double {
  guard values.count >= 2 else { return 0 }
  let mean = values.reduce(0, +) / Double(values.count)
  let variance = values.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / Double(values.count - 1)
  return sqrt(max(0, variance))
}
