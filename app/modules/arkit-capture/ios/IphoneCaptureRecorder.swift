import AVFoundation
import CoreMotion
import Foundation

struct IphoneCaptureSettings {
  var autoFocus = true
  var autoExposure = true
  var imuRateHz = 100
}

struct IphoneVideoImuCalibration {
  static let convention = "imu_event_timestamp_minus_video_event_timestamp"

  let offsetNs: Int64
  let source: String
  let measuredAt: String?
  let quality: String?
  let peakCorrelation: Double?
  let standardDeviationMs: Double?

  static let unmeasured = IphoneVideoImuCalibration(
    offsetNs: 0,
    source: "unmeasured_zero_default",
    measuredAt: nil,
    quality: nil,
    peakCorrelation: nil,
    standardDeviationMs: nil)

  var auditDictionary: [String: Any] {
    [
      "offset_ns": offsetNs,
      "convention": Self.convention,
      "source": source,
      "measured_at": measuredAt.map { $0 as Any } ?? NSNull(),
      "quality": quality.map { $0 as Any } ?? NSNull(),
      "peak_correlation": peakCorrelation.map { $0 as Any } ?? NSNull(),
      "standard_deviation_ms": standardDeviationMs.map { $0 as Any } ?? NSNull(),
    ]
  }
}

/// File writer shared by the AVCapture video/audio callbacks and Core Motion.
/// Its delivered output is intentionally the same four-file manifest as Mentra.
final class IphoneCaptureRecorder {
  private struct FrameRecord {
    let frameIndex: Int
    let sourceTimestampNs: Int64
    let systemUptimeTimestampNs: Int64
    let inputClockTimestampNs: Int64
    let mp4PtsNs: Int64
    let exposureDurationNs: Int64?
    let iso: Float?
  }

  private struct ImuTimeline {
    var accelerometer: [Int64] = []
    var gyroscope: [Int64] = []
  }

  private let motionManager = CMMotionManager()
  private let motionQueue: OperationQueue = {
    let queue = OperationQueue()
    queue.name = "io.rootlens.iphone-capture.imu"
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .userInteractive
    return queue
  }()
  private let sensorQueue = DispatchQueue(label: "io.rootlens.iphone-capture.files", qos: .utility)
  private let timelineLock = NSLock()
  private let recordingStateLock = NSLock()

  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var imuHandle: FileHandle?
  private var sessionDir: URL?
  private var videoStartPts: CMTime = .invalid
  private var frameRecords: [FrameRecord] = []
  private var imuTimeline = ImuTimeline()
  private var accelerometerIndex = 0
  private var gyroscopeIndex = 0
  private var settings = IphoneCaptureSettings()
  private var calibration = IphoneVideoImuCalibration.unmeasured
  private var cameraMetadata: [String: Any] = [:]
  private var recordingStartedAt = Date()
  private var recordingStoppedAt = Date()
  private var videoAppendFailures = 0
  private var videoSamplesDiscardedBeforeImuCoverage = 0
  private var audioAppendFailures = 0
  private var audioSampleCount = 0
  private var fileWriteError: Error?
  private var recordingActive = false

  var isRecording: Bool {
    recordingStateLock.lock()
    defer { recordingStateLock.unlock() }
    return recordingActive
  }

  func start(
    dir: URL,
    videoSize: CGSize,
    transform: CGAffineTransform,
    settings: IphoneCaptureSettings,
    calibration: IphoneVideoImuCalibration,
    cameraMetadata: [String: Any]
  ) throws -> URL {
    guard !isRecording else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "already recording"])
    }
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let videoURL = dir.appendingPathComponent("rgb.mp4")
    let imuURL = dir.appendingPathComponent("imu.jsonl")
    try removeIfPresent(videoURL)
    try removeIfPresent(imuURL)

    let writer = try AVAssetWriter(outputURL: videoURL, fileType: .mp4)
    writer.movieFragmentInterval = CMTimeMakeWithSeconds(10, preferredTimescale: 600)
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(videoSize.width),
      AVVideoHeightKey: Int(videoSize.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 12_000_000,
        AVVideoMaxKeyFrameIntervalKey: 60,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: false,
      ],
    ]
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    videoInput.expectsMediaDataInRealTime = true
    videoInput.transform = transform
    guard writer.canAdd(videoInput) else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add video input"])
    }
    writer.add(videoInput)

    let audioSettings: [String: Any] = [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 48_000,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 96_000,
    ]
    let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings)
    audioInput.expectsMediaDataInRealTime = true
    guard writer.canAdd(audioInput) else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add audio input"])
    }
    writer.add(audioInput)

    FileManager.default.createFile(atPath: imuURL.path, contents: nil)
    let imuHandle = try FileHandle(forWritingTo: imuURL)

    self.writer = writer
    self.videoInput = videoInput
    self.audioInput = audioInput
    self.imuHandle = imuHandle
    self.sessionDir = dir
    self.videoStartPts = .invalid
    self.frameRecords = []
    self.imuTimeline = ImuTimeline()
    self.accelerometerIndex = 0
    self.gyroscopeIndex = 0
    self.settings = settings
    self.calibration = calibration
    self.cameraMetadata = cameraMetadata
    self.videoAppendFailures = 0
    self.videoSamplesDiscardedBeforeImuCoverage = 0
    self.audioAppendFailures = 0
    self.audioSampleCount = 0
    self.fileWriteError = nil
    setRecordingActive(true)
    startMotion()
    let requiredHistorySeconds = max(0.05, max(0, -Double(calibration.offsetNs) / 1_000_000_000) + 0.05)
    guard waitForMotionSamples(
      minimumCount: 2,
      minimumHistorySeconds: requiredHistorySeconds,
      timeoutSeconds: max(1.0, requiredHistorySeconds + 0.5)
    ) else {
      setRecordingActive(false)
      stopMotion()
      try? imuHandle.close()
      self.imuHandle = nil
      resetWriterState()
      throw NSError(domain: "IphoneCaptureRecorder", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "IMU did not become ready before video recording"])
    }
    self.recordingStartedAt = Date()
    return dir
  }

  /// Called on the controller's serial capture queue.
  func ingestVideo(
    _ sampleBuffer: CMSampleBuffer,
    systemUptimeTimestamp: CMTime,
    inputClockTimestamp: CMTime
  ) {
    guard isRecording,
          let writer,
          let videoInput,
          CMSampleBufferDataIsReady(sampleBuffer) else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard pts.isValid, systemUptimeTimestamp.isValid, inputClockTimestamp.isValid else { return }
    let sourceNs = Self.nanoseconds(pts)
    let systemUptimeNs = Self.nanoseconds(systemUptimeTimestamp)
    let inputClockNs = Self.nanoseconds(inputClockTimestamp)
    if writer.status == .unknown {
      let associationTimestampNs = inputClockNs + calibration.offsetNs
      guard hasMotionHistory(atOrBefore: associationTimestampNs) else {
        videoSamplesDiscardedBeforeImuCoverage += 1
        return
      }
      guard writer.startWriting() else { return }
      writer.startSession(atSourceTime: pts)
      videoStartPts = pts
    }
    guard writer.status == .writing, videoInput.isReadyForMoreMediaData else { return }
    if videoInput.append(sampleBuffer) {
      let relativeNs = max(0, Self.nanoseconds(CMTimeSubtract(pts, videoStartPts)))
      frameRecords.append(FrameRecord(
        frameIndex: frameRecords.count,
        sourceTimestampNs: sourceNs,
        systemUptimeTimestampNs: systemUptimeNs,
        inputClockTimestampNs: inputClockNs,
        mp4PtsNs: relativeNs,
        exposureDurationNs: nil,
        iso: nil))
    } else {
      videoAppendFailures += 1
    }
  }

  /// Called on the same serial capture queue as ingestVideo.
  func ingestAudio(_ sampleBuffer: CMSampleBuffer) {
    guard isRecording,
          let writer,
          let audioInput,
          videoStartPts.isValid,
          writer.status == .writing,
          CMSampleBufferGetPresentationTimeStamp(sampleBuffer) >= videoStartPts,
          audioInput.isReadyForMoreMediaData else { return }
    if audioInput.append(sampleBuffer) { audioSampleCount += 1 }
    else { audioAppendFailures += 1 }
  }

  func stop() throws -> URL {
    guard isRecording, let writer, let videoInput, let audioInput, let dir = sessionDir else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "not recording"])
    }
    recordingStoppedAt = Date()
    if let lastFrame = frameRecords.last {
      let associationTimestampNs = lastFrame.inputClockTimestampNs + calibration.offsetNs
      _ = waitForMotionCoverage(after: associationTimestampNs, timeoutSeconds: 1.0)
    }
    setRecordingActive(false)
    stopMotion()
    sensorQueue.sync {
      do {
        try imuHandle?.synchronize()
        try imuHandle?.close()
      } catch {
        if fileWriteError == nil { fileWriteError = error }
      }
      imuHandle = nil
    }
    guard videoStartPts.isValid, !frameRecords.isEmpty else {
      writer.cancelWriting()
      resetWriterState()
      throw NSError(domain: "IphoneCaptureRecorder", code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "recording contains no video frames"])
    }

    videoInput.markAsFinished()
    audioInput.markAsFinished()
    let finished = DispatchSemaphore(value: 0)
    writer.finishWriting { finished.signal() }
    guard finished.wait(timeout: .now() + 60) == .success else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "timed out finalizing MP4"])
    }
    guard writer.status == .completed else {
      let message = writer.error?.localizedDescription ?? "AVAssetWriter status \(writer.status.rawValue)"
      resetWriterState()
      throw NSError(domain: "IphoneCaptureRecorder", code: 7,
                    userInfo: [NSLocalizedDescriptionKey: message])
    }
    if let fileWriteError {
      resetWriterState()
      throw fileWriteError
    }

    let timeline: ImuTimeline = {
      timelineLock.lock()
      defer { timelineLock.unlock() }
      return imuTimeline
    }()
    guard audioSampleCount > 0 else {
      resetWriterState()
      throw NSError(domain: "IphoneCaptureRecorder", code: 8,
                    userInfo: [NSLocalizedDescriptionKey: "recording contains no audio samples"])
    }
    guard !timeline.accelerometer.isEmpty, !timeline.gyroscope.isEmpty else {
      resetWriterState()
      throw NSError(domain: "IphoneCaptureRecorder", code: 9,
                    userInfo: [NSLocalizedDescriptionKey: "recording contains incomplete IMU streams"])
    }
    try writeFrames(to: dir.appendingPathComponent("frames.jsonl"), timeline: timeline)
    try writeMetadata(to: dir.appendingPathComponent("metadata.json"), timeline: timeline)
    resetWriterState()
    return dir
  }

  private func startMotion() {
    let interval = 1.0 / Double(max(1, settings.imuRateHz))
    if motionManager.isAccelerometerAvailable {
      motionManager.accelerometerUpdateInterval = interval
      motionManager.startAccelerometerUpdates(to: motionQueue) { [weak self] sample, error in
        guard let self, let sample, error == nil, self.isRecording else { return }
        let timestampNs = Int64(sample.timestamp * 1_000_000_000)
        let index: Int = {
          self.timelineLock.lock()
          defer { self.timelineLock.unlock() }
          self.imuTimeline.accelerometer.append(timestampNs)
          let value = self.accelerometerIndex
          self.accelerometerIndex += 1
          return value
        }()
        let g = 9.80665
        self.appendImuRow(sensor: "accelerometer", index: index, timestampNs: timestampNs,
                          x: sample.acceleration.x * g,
                          y: sample.acceleration.y * g,
                          z: sample.acceleration.z * g)
      }
    }
    if motionManager.isGyroAvailable {
      motionManager.gyroUpdateInterval = interval
      motionManager.startGyroUpdates(to: motionQueue) { [weak self] sample, error in
        guard let self, let sample, error == nil, self.isRecording else { return }
        let timestampNs = Int64(sample.timestamp * 1_000_000_000)
        let index: Int = {
          self.timelineLock.lock()
          defer { self.timelineLock.unlock() }
          self.imuTimeline.gyroscope.append(timestampNs)
          let value = self.gyroscopeIndex
          self.gyroscopeIndex += 1
          return value
        }()
        self.appendImuRow(sensor: "gyroscope", index: index, timestampNs: timestampNs,
                          x: sample.rotationRate.x,
                          y: sample.rotationRate.y,
                          z: sample.rotationRate.z)
      }
    }
  }

  private func stopMotion() {
    motionManager.stopAccelerometerUpdates()
    motionManager.stopGyroUpdates()
    motionQueue.waitUntilAllOperationsAreFinished()
  }

  private func waitForMotionSamples(
    minimumCount: Int,
    minimumHistorySeconds: TimeInterval,
    timeoutSeconds: TimeInterval
  ) -> Bool {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    let minimumHistoryNs = Int64((minimumHistorySeconds * 1_000_000_000).rounded())
    while Date() < deadline {
      timelineLock.lock()
      let ready = imuTimeline.accelerometer.count >= minimumCount
        && imuTimeline.gyroscope.count >= minimumCount
        && (imuTimeline.accelerometer.last ?? 0) - (imuTimeline.accelerometer.first ?? 0) >= minimumHistoryNs
        && (imuTimeline.gyroscope.last ?? 0) - (imuTimeline.gyroscope.first ?? 0) >= minimumHistoryNs
      timelineLock.unlock()
      if ready { return true }
      Thread.sleep(forTimeInterval: 0.005)
    }
    return false
  }

  private func waitForMotionCoverage(after timestampNs: Int64, timeoutSeconds: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while Date() < deadline {
      timelineLock.lock()
      let ready = (imuTimeline.accelerometer.last ?? Int64.min) > timestampNs
        && (imuTimeline.gyroscope.last ?? Int64.min) > timestampNs
      timelineLock.unlock()
      if ready { return true }
      Thread.sleep(forTimeInterval: 0.005)
    }
    return false
  }

  /// The capture queue is blocked while start() warms up Core Motion, but camera
  /// callbacks produced during that interval can already be waiting in the queue.
  /// Do not let one of those older callbacks become frame 0 unless its calibrated
  /// association time has a preceding sample in both IMU streams.
  private func hasMotionHistory(atOrBefore timestampNs: Int64) -> Bool {
    timelineLock.lock()
    defer { timelineLock.unlock() }
    guard let accelerometerStart = imuTimeline.accelerometer.first,
          let gyroscopeStart = imuTimeline.gyroscope.first else { return false }
    return accelerometerStart <= timestampNs && gyroscopeStart <= timestampNs
  }

  private func appendImuRow(
    sensor: String,
    index: Int,
    timestampNs: Int64,
    x: Double,
    y: Double,
    z: Double
  ) {
    guard let handle = imuHandle else { return }
    let row: [String: Any] = [
      "sensor": sensor,
      "sample_index": index,
      "timestamp_ns": timestampNs,
      "receipt_system_uptime_ns": Int64(ProcessInfo.processInfo.systemUptime * 1_000_000_000),
      "accuracy": NSNull(),
      "x": x,
      "y": y,
      "z": z,
    ]
    sensorQueue.async { [weak self] in
      do { try Self.appendJsonLine(row, to: handle) }
      catch { if self?.fileWriteError == nil { self?.fileWriteError = error } }
    }
  }

  private func writeFrames(to url: URL, timeline: ImuTimeline) throws {
    try removeIfPresent(url)
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    for frame in frameRecords {
      let associationNs = frame.inputClockTimestampNs + calibration.offsetNs
      let accelBefore = Self.floorIndex(timeline.accelerometer, associationNs)
      let gyroBefore = Self.floorIndex(timeline.gyroscope, associationNs)
      guard accelBefore >= 0,
            accelBefore + 1 < timeline.accelerometer.count,
            gyroBefore >= 0,
            gyroBefore + 1 < timeline.gyroscope.count else {
        throw NSError(domain: "IphoneCaptureRecorder", code: 11,
                      userInfo: [NSLocalizedDescriptionKey:
                        "frame \(frame.frameIndex) is not bracketed by both IMU streams"])
      }
      var row: [String: Any] = [
        "frame_index": frame.frameIndex,
        "mp4_sample_index": frame.frameIndex,
        "mp4_pts_ns": frame.mp4PtsNs,
        "mp4_sample_size_bytes": NSNull(),
        "mp4_key_frame": NSNull(),
        "timestamp_ns": frame.sourceTimestampNs,
        "video_frame_timestamp_system_uptime_ns": frame.systemUptimeTimestampNs,
        "video_frame_timestamp_canonical_ns": frame.inputClockTimestampNs,
        "video_frame_timestamp_source": "CMSyncConvertTime(CMSampleBuffer.presentationTimeStamp, AVCaptureSession.synchronizationClock, AVCaptureInput.Port.clock)",
        "camera_result_present": true,
        "camera_result_index": frame.frameIndex,
        "camera_sensor_timestamp_ns": frame.sourceTimestampNs,
        "camera_timestamp_mapped_system_uptime_ns": frame.systemUptimeTimestampNs,
        "camera_timestamp_mapped_input_port_clock_ns": frame.inputClockTimestampNs,
        "camera_to_system_uptime_offset_ns": frame.systemUptimeTimestampNs - frame.sourceTimestampNs,
        "camera_to_input_port_clock_offset_ns": frame.inputClockTimestampNs - frame.sourceTimestampNs,
        "video_to_imu_offset_ns": calibration.offsetNs,
        "video_to_imu_offset_convention": IphoneVideoImuCalibration.convention,
        "imu_association_timestamp_ns": associationNs,
        "mapping_quality": "Apple-documented session-to-input-port reverse mapping for Core Motion comparison; host conversion retained as an independent diagnostic; residual measured end-to-end",
        "exposure_time_ns": Self.nullable(frame.exposureDurationNs),
        "sensitivity_iso": Self.nullable(frame.iso),
      ]
      Self.putNeighbors(&row, prefix: "accelerometer", values: timeline.accelerometer, before: accelBefore)
      Self.putNeighbors(&row, prefix: "gyroscope", values: timeline.gyroscope, before: gyroBefore)
      try Self.appendJsonLine(row, to: handle)
    }
    try handle.synchronize()
  }

  private func writeMetadata(to url: URL, timeline: ImuTimeline) throws {
    let info = Bundle.main.infoDictionary
    let appVersion = info?["CFBundleShortVersionString"] as? String ?? "?"
    let appBuild = info?["CFBundleVersion"] as? String ?? "?"
    let durationMs = max(1, Int(recordingStoppedAt.timeIntervalSince(recordingStartedAt) * 1000))
    let metadata: [String: Any] = [
      "schema": "rootlens.iphone.raw.v1",
      "recording_config": "iphone",
      "created_at": ISO8601DateFormatter().string(from: recordingStartedAt),
      "stopped_at": ISO8601DateFormatter().string(from: recordingStoppedAt),
      "actual_duration_ms": durationMs,
      "device_model": Self.deviceModelIdentifier(),
      "os_name": "iOS",
      "os_version": UIDevice.current.systemVersion,
      "app_version": "\(appVersion) (\(appBuild))",
      "video": [
        "mime": "video/avc",
        "width": 1920,
        "height": 1080,
        "frame_rate": 30,
        "bit_depth": 8,
        "hdr": false,
      ],
      "audio": [
        "mime": "audio/mp4a-latm",
        "sample_rate_hz": 48_000,
        "channel_count": 1,
        "bitrate_bps": 96_000,
      ],
      "video_frame_count": frameRecords.count,
      "accelerometer_sample_count": timeline.accelerometer.count,
      "gyroscope_sample_count": timeline.gyroscope.count,
      "video_append_failure_count": videoAppendFailures,
      "video_samples_discarded_before_imu_coverage": videoSamplesDiscardedBeforeImuCoverage,
      "audio_append_failure_count": audioAppendFailures,
      "audio_sample_count": audioSampleCount,
      "capture_configuration": [
        "width": 1920,
        "height": 1080,
        "fps": 30,
        "bitrate_bps": 12_000_000,
        "codec": "video/avc",
        "audio": true,
        "orientation": "landscape",
        "imu_rate_hz": settings.imuRateHz,
        "video_to_imu_offset_ns": calibration.offsetNs,
        "video_to_imu_offset_convention": IphoneVideoImuCalibration.convention,
        "video_to_imu_calibration": calibration.auditDictionary,
      ],
      "timestamp_timebase": [
        "unit": "nanoseconds",
        "clock": "camera_input_port_clock_compared_with_coremotion_boot_time",
        "video_source": "CMSampleBuffer.presentationTimeStamp",
        "video_source_clock": "AVCaptureSession.synchronizationClock",
        "video_mapped_field": "video_frame_timestamp_canonical_ns",
        "video_mapped_clock": "AVCaptureInput.Port.clock",
        "video_host_diagnostic_field": "camera_timestamp_mapped_system_uptime_ns",
        "video_host_diagnostic_clock": "CMClockGetHostTimeClock/system_uptime",
        "video_clock_model_schema": "rootlens.camera_imu_clock_model.v1",
        "canonical_timestamps_generated_at_capture": true,
        "clock_model": try deliveredClockModel(),
        "imu_source": "CMAccelerometerData.timestamp / CMGyroData.timestamp",
        "raw_timestamps_modified": false,
      ],
      "camera": cameraMetadata,
      "files": ["rgb.mp4", "frames.jsonl", "imu.jsonl", "metadata.json"],
    ]
    let data = try JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: url, options: .atomic)
  }

  private func deliveredClockModel() throws -> [String: Any] {
    guard let mapping = cameraMetadata["clock_mapping_start"] as? [String: Any],
          let sourceAnchor = mapping["synchronization_to_input_anchor_ns"],
          let targetAnchor = mapping["input_port_anchor_ns"],
          let sourceRatePerTargetRate = mapping["synchronization_to_input_relative_rate"] as? Double,
          sourceRatePerTargetRate.isFinite,
          sourceRatePerTargetRate != 0 else {
      throw NSError(domain: "IphoneCaptureRecorder", code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "canonical clock model is unavailable"])
    }
    return [
      "model_type": "affine",
      "equation": "target_ns = target_anchor_ns + (source_ns - source_anchor_ns) * target_rate_per_source_rate",
      "source_clock": "AVCaptureSession.synchronizationClock",
      "target_clock": "AVCaptureInput.Port.clock / Core Motion comparison timeline",
      "source_anchor_ns": sourceAnchor,
      "target_anchor_ns": targetAnchor,
      "target_rate_per_source_rate": 1.0 / sourceRatePerTargetRate,
      "offset_convention": IphoneVideoImuCalibration.convention,
    ]
  }

  private func resetWriterState() {
    writer = nil
    videoInput = nil
    audioInput = nil
    sessionDir = nil
    videoStartPts = .invalid
  }

  private func setRecordingActive(_ value: Bool) {
    recordingStateLock.lock()
    recordingActive = value
    recordingStateLock.unlock()
  }

  private func removeIfPresent(_ url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  private static func nanoseconds(_ time: CMTime) -> Int64 {
    guard time.isValid else { return 0 }
    return Int64((CMTimeGetSeconds(time) * 1_000_000_000).rounded())
  }

  private static func floorIndex(_ values: [Int64], _ target: Int64) -> Int {
    var low = 0
    var high = values.count
    while low < high {
      let mid = low + (high - low) / 2
      if values[mid] <= target { low = mid + 1 } else { high = mid }
    }
    return low - 1
  }

  private static func putNeighbors(
    _ row: inout [String: Any],
    prefix: String,
    values: [Int64],
    before: Int
  ) {
    let after = before + 1 < values.count ? before + 1 : -1
    row["\(prefix)_before_index"] = nullable(before >= 0 ? before : nil)
    row["\(prefix)_before_timestamp_ns"] = nullable(before >= 0 ? values[before] : nil)
    row["\(prefix)_after_index"] = nullable(after >= 0 ? after : nil)
    row["\(prefix)_after_timestamp_ns"] = nullable(after >= 0 ? values[after] : nil)
  }

  private static func nullable<T>(_ value: T?) -> Any {
    if let value { return value }
    return NSNull()
  }

  private static func appendJsonLine(_ object: [String: Any], to handle: FileHandle) throws {
    let data = try JSONSerialization.data(withJSONObject: object)
    try handle.write(contentsOf: data)
    try handle.write(contentsOf: Data("\n".utf8))
  }

  private static func deviceModelIdentifier() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
    }
  }
}
