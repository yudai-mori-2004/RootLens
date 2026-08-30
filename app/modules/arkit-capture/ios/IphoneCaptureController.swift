import AVFoundation
import CoreImage
import CoreMotion
import CoreVideo
import Foundation
import UIKit

protocol IphoneCaptureControllerDelegate: AnyObject {
  func iphoneCapture(didTrackHand output: HandTracker.Output)
}

/// AVCaptureSession backend for the settings-level `iphone` method. ARKit and
/// this controller are peers: they share hand tracking and the residual
/// analyzer, but own separate camera-session implementations.
final class IphoneCaptureController: NSObject,
  AVCaptureVideoDataOutputSampleBufferDelegate,
  AVCaptureAudioDataOutputSampleBufferDelegate {

  static let shared = IphoneCaptureController()

  weak var delegate: IphoneCaptureControllerDelegate?
  let session = AVCaptureSession()

  private let captureQueue = DispatchQueue(label: "io.rootlens.iphone-capture.capture", qos: .userInitiated)
  private let handQueue = DispatchQueue(label: "io.rootlens.iphone-capture.hands", qos: .userInitiated)
  private let videoOutput = AVCaptureVideoDataOutput()
  private let audioOutput = AVCaptureAudioDataOutput()
  private let recorder = IphoneCaptureRecorder()
  private let handTracker = HandTracker()
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
  private let latestBufferLock = NSLock()
  private let orientationLock = NSLock()
  private let handBusyLock = NSLock()
  private let settingsLock = NSLock()
  private var videoInput: AVCaptureDeviceInput?
  private var latestPixelBuffer: CVPixelBuffer?
  private var handBusy = false
  private var handFrameCounter = 0
  private var sessionRunning = false
  private var displayOrientation: DisplayOrientation = .landscapeRight
  private var settings = IphoneCaptureSettings()
  private var previewViews = NSHashTable<IphoneCapturePreviewView>.weakObjects()
  private var videoSynchronizationClock: CMClock?
  private var videoInputClock: CMClock?

  private static let validationDefaultsPrefix = "io.rootlens.camera-imu-time-validation.v3.iphone-ultrawide."

  static func isAvailable() -> Bool {
    AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) != nil
      && CMMotionManager().isAccelerometerAvailable
      && CMMotionManager().isGyroAvailable
  }

  func applyCaptureSettings(json: String) {
    guard let data = json.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
    var next = IphoneCaptureSettings()
    if let value = object["autoFocus"] as? Bool { next.autoFocus = value }
    if let value = object["autoExposure"] as? Bool { next.autoExposure = value }
    if let value = object["imuRateHz"] as? Int { next.imuRateHz = value }
    settingsLock.lock()
    settings = next
    settingsLock.unlock()
  }

  private func currentSettings() -> IphoneCaptureSettings {
    settingsLock.lock()
    defer { settingsLock.unlock() }
    return settings
  }

  func setDisplayOrientation(_ value: DisplayOrientation) {
    orientationLock.lock()
    displayOrientation = value
    orientationLock.unlock()
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      for view in self.previewViews.allObjects { view.applyOrientation(value) }
    }
  }

  func currentDisplayOrientation() -> DisplayOrientation {
    orientationLock.lock()
    defer { orientationLock.unlock() }
    return displayOrientation
  }

  func registerPreview(_ view: IphoneCapturePreviewView) {
    if Thread.isMainThread { previewViews.add(view) }
    else { DispatchQueue.main.async { [weak self, weak view] in if let view { self?.previewViews.add(view) } } }
  }

  func unregisterPreview(_ view: IphoneCapturePreviewView) {
    if Thread.isMainThread { previewViews.remove(view) }
  }

  func startSession() throws {
    var result: Result<Void, Error> = .success(())
    captureQueue.sync {
      guard !sessionRunning else { return }
      do {
        try configureAudioSession()
        try configureSession()
        session.startRunning()
        guard let synchronizationClock = captureSynchronizationClock(),
              let inputClock = captureInputClock() else {
          session.stopRunning()
          throw NSError(domain: "IphoneCaptureController", code: 17,
                        userInfo: [NSLocalizedDescriptionKey: "capture synchronization/input clock unavailable"])
        }
        videoSynchronizationClock = synchronizationClock
        videoInputClock = inputClock
        sessionRunning = true
        refreshPreviewOrientation()
      } catch {
        result = .failure(error)
      }
    }
    try result.get()
  }

  func stopSession() {
    captureQueue.sync {
      guard sessionRunning else { return }
      videoOutput.setSampleBufferDelegate(nil, queue: nil)
      audioOutput.setSampleBufferDelegate(nil, queue: nil)
      session.stopRunning()
      session.beginConfiguration()
      session.inputs.forEach(session.removeInput)
      session.outputs.forEach(session.removeOutput)
      session.commitConfiguration()
      videoInput = nil
      videoSynchronizationClock = nil
      videoInputClock = nil
      latestBufferLock.lock()
      latestPixelBuffer = nil
      latestBufferLock.unlock()
      sessionRunning = false
    }
    handQueue.sync {}
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func configureAudioSession() throws {
    let audioSession = AVAudioSession.sharedInstance()
    try audioSession.setCategory(
      .playAndRecord,
      mode: .videoRecording,
      options: [.defaultToSpeaker, .allowBluetoothA2DP])
    try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
    session.automaticallyConfiguresApplicationAudioSession = false
  }

  private func configureSession() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    session.inputs.forEach(session.removeInput)
    session.outputs.forEach(session.removeOutput)
    session.sessionPreset = .inputPriority

    guard let camera = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) else {
      throw NSError(domain: "IphoneCaptureController", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "ultra-wide camera unavailable"])
    }
    let formats = camera.formats.filter { format in
      let dimensions = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      return dimensions.width == 1920 && dimensions.height == 1080
        && format.videoSupportedFrameRateRanges.contains { $0.minFrameRate <= 30 && $0.maxFrameRate >= 30 }
    }
    guard let selected = formats.max(by: {
      let left = CMFormatDescriptionGetMediaSubType($0.formatDescription)
      let right = CMFormatDescriptionGetMediaSubType($1.formatDescription)
      return (left == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ? 1 : 0)
        < (right == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange ? 1 : 0)
    }) else {
      throw NSError(domain: "IphoneCaptureController", code: 11,
                    userInfo: [NSLocalizedDescriptionKey: "1920x1080 @ 30 fps ultra-wide format unavailable"])
    }
    let currentSettings = currentSettings()
    try camera.lockForConfiguration()
    camera.activeFormat = selected
    camera.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
    camera.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
    if camera.isFocusModeSupported(currentSettings.autoFocus ? .continuousAutoFocus : .locked) {
      camera.focusMode = currentSettings.autoFocus ? .continuousAutoFocus : .locked
    }
    if camera.isExposureModeSupported(currentSettings.autoExposure ? .continuousAutoExposure : .locked) {
      camera.exposureMode = currentSettings.autoExposure ? .continuousAutoExposure : .locked
    }
    camera.unlockForConfiguration()

    let cameraInput = try AVCaptureDeviceInput(device: camera)
    guard session.canAddInput(cameraInput) else {
      throw NSError(domain: "IphoneCaptureController", code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
    }
    session.addInput(cameraInput)
    videoInput = cameraInput

    guard let microphone = AVCaptureDevice.default(for: .audio) else {
      throw NSError(domain: "IphoneCaptureController", code: 13,
                    userInfo: [NSLocalizedDescriptionKey: "microphone unavailable"])
    }
    let microphoneInput = try AVCaptureDeviceInput(device: microphone)
    guard session.canAddInput(microphoneInput) else {
      throw NSError(domain: "IphoneCaptureController", code: 14,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add microphone input"])
    }
    session.addInput(microphoneInput)

    videoOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    videoOutput.alwaysDiscardsLateVideoFrames = true
    videoOutput.setSampleBufferDelegate(self, queue: captureQueue)
    guard session.canAddOutput(videoOutput) else {
      throw NSError(domain: "IphoneCaptureController", code: 15,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add video output"])
    }
    session.addOutput(videoOutput)
    if let connection = videoOutput.connection(with: .video) {
      if connection.isCameraIntrinsicMatrixDeliverySupported {
        connection.isCameraIntrinsicMatrixDeliveryEnabled = true
      }
      if connection.isVideoOrientationSupported { connection.videoOrientation = .landscapeRight }
    }

    audioOutput.setSampleBufferDelegate(self, queue: captureQueue)
    guard session.canAddOutput(audioOutput) else {
      throw NSError(domain: "IphoneCaptureController", code: 16,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add audio output"])
    }
    session.addOutput(audioOutput)
  }

  private func refreshPreviewOrientation() {
    let orientation = currentDisplayOrientation()
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      for view in self.previewViews.allObjects {
        view.applyOrientation(orientation)
        view.setNeedsLayout()
      }
    }
  }

  func startRecording(sessionDir: URL) throws -> URL {
    var result: Result<URL, Error>!
    captureQueue.sync {
      do {
        guard sessionRunning,
              let camera = videoInput?.device,
              let videoSynchronizationClock,
              let videoInputClock else {
          throw NSError(domain: "IphoneCaptureController", code: 18,
                        userInfo: [NSLocalizedDescriptionKey: "capture session is not running"])
        }
        let dimensions = CMVideoFormatDescriptionGetDimensions(camera.activeFormat.formatDescription)
        let cameraMetadata: [String: Any] = [
          "lens": "ultra_wide",
          "device_type": camera.deviceType.rawValue,
          "field_of_view_deg": camera.activeFormat.videoFieldOfView,
          "width": Int(dimensions.width),
          "height": Int(dimensions.height),
          "fps": 30,
          "clock_mapping_start": makeClockMappingDictionary(
            synchronizationClock: videoSynchronizationClock,
            inputClock: videoInputClock),
        ]
        result = .success(try recorder.start(
          dir: sessionDir,
          videoSize: CGSize(width: 1920, height: 1080),
          transform: currentDisplayOrientation().videoTransform,
          settings: currentSettings(),
          calibration: currentCalibration(),
          cameraMetadata: cameraMetadata))
        handTracker.setRecordingMode(true)
      } catch {
        result = .failure(error)
      }
    }
    return try result.get()
  }

  func stopRecording() throws -> URL {
    var result: Result<URL, Error>!
    captureQueue.sync {
      do {
        handTracker.setRecordingMode(false)
        result = .success(try recorder.stop())
      } catch {
        result = .failure(error)
      }
    }
    return try result.get()
  }

  func captureSnapshot() throws -> URL {
    latestBufferLock.lock()
    let buffer = latestPixelBuffer
    latestBufferLock.unlock()
    guard let buffer else {
      throw NSError(domain: "IphoneCaptureController", code: 18,
                    userInfo: [NSLocalizedDescriptionKey: "no frame available"])
    }
    let image = CIImage(cvPixelBuffer: buffer).oriented(currentDisplayOrientation().cgImageOrientation)
    guard let cg = ciContext.createCGImage(image, from: image.extent),
          let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.85) else {
      throw NSError(domain: "IphoneCaptureController", code: 19,
                    userInfo: [NSLocalizedDescriptionKey: "could not encode snapshot"])
    }
    let url = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("iphone_snapshot_\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
    try data.write(to: url, options: .atomic)
    return url
  }

  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    if output === audioOutput {
      recorder.ingestAudio(sampleBuffer)
      return
    }
    guard output === videoOutput, let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    latestBufferLock.lock()
    latestPixelBuffer = pixelBuffer
    latestBufferLock.unlock()
    let sourceTimestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    guard sourceTimestamp.isValid,
          let videoSynchronizationClock,
          let inputClock = connection.inputPorts.first?.clock else { return }
    let systemUptimeTimestamp = CMSyncConvertTime(
      sourceTimestamp,
      from: videoSynchronizationClock,
      to: CMClockGetHostTimeClock())
    let inputClockTimestamp = CMSyncConvertTime(
      sourceTimestamp,
      from: videoSynchronizationClock,
      to: inputClock)
    guard systemUptimeTimestamp.isValid, inputClockTimestamp.isValid else { return }
    recorder.ingestVideo(
      sampleBuffer,
      systemUptimeTimestamp: systemUptimeTimestamp,
      inputClockTimestamp: inputClockTimestamp)

    handFrameCounter += 1
    guard handFrameCounter >= 2 else { return }
    handFrameCounter = 0
    handBusyLock.lock()
    let mayRun = !handBusy
    if mayRun { handBusy = true }
    handBusyLock.unlock()
    guard mayRun else { return }
    let orientation = currentDisplayOrientation().cgImageOrientation
    // Apple documents the input-port clock as the original clock to use when
    // correlating capture output with external Core Motion samples. Keep the
    // host conversion as a separately recorded cross-check.
    let timestamp = CMTimeGetSeconds(inputClockTimestamp)
    let timestampNs = UInt64(max(0, timestamp * 1_000_000_000))
    handQueue.async { [weak self] in
      guard let self else { return }
      defer {
        self.handBusyLock.lock()
        self.handBusy = false
        self.handBusyLock.unlock()
      }
      let result = self.handTracker.process(
        pixelBuffer: pixelBuffer,
        segmentationBuffer: nil,
        orientation: orientation,
        timestamp: timestamp,
        timestampNs: timestampNs)
      self.delegate?.iphoneCapture(didTrackHand: result)
    }
  }

  func lastCameraImuTimeValidation() -> [String: Any]? {
    let key = Self.validationDefaultsPrefix + deviceModelIdentifier()
    guard let data = UserDefaults.standard.data(forKey: key),
          let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return value
  }

  func storeCameraImuTimeValidation(_ estimate: CameraImuTimeCalibrator.Estimate) -> [String: Any] {
    let value = makeValidationDictionary(estimate)
    let key = Self.validationDefaultsPrefix + deviceModelIdentifier()
    if estimate.quality == "good",
       let data = try? JSONSerialization.data(withJSONObject: value) {
      UserDefaults.standard.set(data, forKey: key)
    }
    return value
  }

  private func currentCalibration() -> IphoneVideoImuCalibration {
    guard let value = lastCameraImuTimeValidation(),
          (value["algorithmVersion"] as? NSNumber)?.intValue == CameraImuTimeCalibrator.algorithmVersion,
          value["quality"] as? String == "good",
          let offsetMs = value["videoToImuOffsetMs"] as? NSNumber else { return .unmeasured }
    return IphoneVideoImuCalibration(
      offsetNs: Int64((offsetMs.doubleValue * 1_000_000).rounded()),
      source: "on_device_pixel_motion_vs_gyro",
      measuredAt: value["measuredAt"] as? String,
      quality: value["quality"] as? String,
      peakCorrelation: (value["peakCorrelation"] as? NSNumber)?.doubleValue,
      standardDeviationMs: (value["standardDeviationMs"] as? NSNumber)?.doubleValue)
  }

  private func makeValidationDictionary(_ estimate: CameraImuTimeCalibrator.Estimate) -> [String: Any] {
    [
      "deviceModel": deviceModelIdentifier(),
      "osVersion": UIDevice.current.systemVersion,
      "measuredAt": ISO8601DateFormatter().string(from: Date()),
      "algorithmVersion": CameraImuTimeCalibrator.algorithmVersion,
      "searchRangeMinMs": CameraImuTimeCalibrator.searchRangeMinMs,
      "searchRangeMaxMs": CameraImuTimeCalibrator.searchRangeMaxMs,
      "videoWidth": 1920,
      "videoHeight": 1080,
      "videoFps": 30,
      "cameraType": AVCaptureDevice.DeviceType.builtInUltraWideCamera.rawValue,
      "imuRateHz": currentSettings().imuRateHz,
      "videoTimestampSource": "CMSyncConvertTime(CMSampleBuffer.presentationTimeStamp, AVCaptureSession.synchronizationClock, AVCaptureInput.Port.clock)",
      "videoRawTimestampSource": "CMSampleBuffer.presentationTimeStamp",
      "videoRawTimestampClock": "AVCaptureSession.synchronizationClock",
      "videoMappedTimestampClock": "AVCaptureInput.Port.clock / Core Motion comparison timeline",
      "videoHostClockDiagnostic": "CMSyncConvertTime(CMSampleBuffer.presentationTimeStamp, AVCaptureSession.synchronizationClock, CMClockGetHostTimeClock())",
      "imuTimestampSource": "CMGyroData.timestamp",
      "method": "pixel_motion_vs_processed_rotation_rate",
      "measurementKind": "residual_validation",
      "timestampCorrectionApplied": false,
      "clockDomainMappingApplied": true,
      "signConvention": "image motion at video time t matches IMU at t + offset",
      "videoToImuOffsetMs": estimate.videoToImuOffsetMs,
      "standardDeviationMs": estimate.standardDeviationMs,
      "rangeMinMs": estimate.rangeMinMs,
      "rangeMaxMs": estimate.rangeMaxMs,
      "peakCorrelation": estimate.peakCorrelation,
      "signalPair": estimate.signalPair,
      "visualSampleCount": estimate.visualSampleCount,
      "gyroSampleCount": estimate.gyroSampleCount,
      "windowCount": estimate.windowCount,
      "durationSeconds": estimate.durationSeconds,
      "quality": estimate.quality,
    ]
  }

  private func deviceModelIdentifier() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafeBytes(of: &info.machine) { raw in
      String(cString: raw.bindMemory(to: CChar.self).baseAddress!)
    }
  }

  private func captureSynchronizationClock() -> CMClock? {
    if #available(iOS 15.4, *) {
      return session.synchronizationClock
    }
    return session.masterClock
  }

  private func captureInputClock() -> CMClock? {
    videoOutput.connection(with: .video)?.inputPorts.first?.clock
  }

  private func makeClockMappingDictionary(
    synchronizationClock: CMClock,
    inputClock: CMClock
  ) -> [String: Any] {
    let hostClock = CMClockGetHostTimeClock()
    var synchronizationToHostRate = 0.0
    var synchronizationAnchor = CMTime.invalid
    var hostAnchor = CMTime.invalid
    let synchronizationToHostStatus = CMSyncGetRelativeRateAndAnchorTime(
      synchronizationClock,
      relativeTo: hostClock,
      relativeRateOut: &synchronizationToHostRate,
      anchorTimeOut: &synchronizationAnchor,
      relativeToAnchorTimeOut: &hostAnchor)

    var synchronizationToInputRate = 0.0
    var synchronizationInputAnchor = CMTime.invalid
    var inputAnchor = CMTime.invalid
    let synchronizationToInputStatus = CMSyncGetRelativeRateAndAnchorTime(
      synchronizationClock,
      relativeTo: inputClock,
      relativeRateOut: &synchronizationToInputRate,
      anchorTimeOut: &synchronizationInputAnchor,
      relativeToAnchorTimeOut: &inputAnchor)

    let synchronizationNow = CMClockGetTime(synchronizationClock)
    let mappedHostNow = CMSyncConvertTime(
      synchronizationNow,
      from: synchronizationClock,
      to: hostClock)
    let mappedInputNow = CMSyncConvertTime(
      synchronizationNow,
      from: synchronizationClock,
      to: inputClock)
    let processUptimeNs = Int64(ProcessInfo.processInfo.systemUptime * 1_000_000_000)

    return [
      "mapping_version": "coremedia_cmsync_v3",
      "recorded_at": ISO8601DateFormatter().string(from: Date()),
      "synchronization_now_ns": Self.nanoseconds(synchronizationNow),
      "mapped_host_now_ns": Self.nanoseconds(mappedHostNow),
      "mapped_input_port_now_ns": Self.nanoseconds(mappedInputNow),
      "process_system_uptime_now_ns": processUptimeNs,
      "mapped_host_minus_process_uptime_ns": Self.nanoseconds(mappedHostNow) - processUptimeNs,
      "mapped_input_port_minus_process_uptime_ns": Self.nanoseconds(mappedInputNow) - processUptimeNs,
      "synchronization_to_host_relative_rate": synchronizationToHostRate,
      "synchronization_to_host_status": synchronizationToHostStatus,
      "synchronization_to_host_anchor_ns": Self.nanoseconds(synchronizationAnchor),
      "host_anchor_ns": Self.nanoseconds(hostAnchor),
      "synchronization_to_input_relative_rate": synchronizationToInputRate,
      "synchronization_to_input_status": synchronizationToInputStatus,
      "synchronization_to_input_anchor_ns": Self.nanoseconds(synchronizationInputAnchor),
      "input_port_anchor_ns": Self.nanoseconds(inputAnchor),
      "synchronization_to_host_might_drift": CMSyncMightDrift(synchronizationClock, hostClock),
      "synchronization_to_input_might_drift": CMSyncMightDrift(synchronizationClock, inputClock),
    ]
  }

  private static func nanoseconds(_ time: CMTime) -> Int64 {
    guard time.isValid else { return 0 }
    return Int64((CMTimeGetSeconds(time) * 1_000_000_000).rounded())
  }
}
