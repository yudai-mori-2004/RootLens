import ARKit
import AVFoundation
import CoreImage
import CoreMotion
import CoreVideo
import Foundation
import ImageIO
import UIKit
import Vision
import simd

// Owns the single ARSession and runs two jobs on it concurrently:
//
//   1. Preview (an ARSCNView attaches to the session; runs before recording starts).
//   2. Recording (AVAssetWriter encodes ARFrame.capturedImage to an H.264 MP4,
//      while sensor streams write alongside: per-frame poses and hand landmarks,
//      IMU, LiDAR depth + confidence, feature points, scene mesh, metadata).
//
// Independently of recording, HandTracker runs on ARFrames at ~15 fps and emits
// the wearer's hand state to React Native as events; that drives the gesture UX.

protocol ArkitCaptureControllerDelegate: AnyObject {
  func arkitCapture(didTrackHand output: HandTracker.Output)
  /// The device thermal state (ProcessInfo.thermalState) changed while recording. "nominal" | "fair" | "serious" | "critical".
  func arkitCapture(didChangeThermalState state: String)
  /// A ROOTLENS-prefixed QR marker was decoded in the camera frame (~4 Hz scan).
  func arkitCapture(didDetectMarker payload: String)
}

extension Notification.Name {
  /// Screen dim for long recordings (power / heat relief). userInfo["dimmed"]: Bool.
  /// PreviewView observes this to pause / resume preview rendering.
  static let rootlensPreviewDim = Notification.Name("io.rootlens.preview.dim")
}

/// Display orientation, pushed in dynamically from the RN ScreenOrientation
/// listener. Used by HandTracker, snapshots, and the recorded MP4's transform.
enum DisplayOrientation {
  case portrait        // UIInterfaceOrientation.portrait
  case landscapeLeft   // usb-c on the left; 180° from the sensor orientation
  case landscapeRight  // usb-c on the right; same as the sensor orientation

  var cgImageOrientation: CGImagePropertyOrientation {
    switch self {
    case .portrait:       return .right   // 90° CW: sensor landscape → display portrait
    case .landscapeRight: return .up      // identity
    case .landscapeLeft:  return .down    // 180°
    }
  }

  /// Matrix for AVAssetWriterInput.transform. The bytes stay in sensor
  /// orientation and the player is told to rotate at playback time, which avoids
  /// a per-frame CoreImage render and its power cost.
  var videoTransform: CGAffineTransform {
    switch self {
    case .landscapeRight: return .identity
    case .landscapeLeft:  return CGAffineTransform(rotationAngle: .pi)         // 180°
    case .portrait:       return CGAffineTransform(rotationAngle: .pi / 2)     // 90° CW
    }
  }
}

final class ArkitCaptureController: NSObject, ARSessionDelegate {
  static let shared = ArkitCaptureController()

  weak var delegate: ArkitCaptureControllerDelegate?

  private let session = ARSession()
  private let ciContext = CIContext(options: [.useSoftwareRenderer: false])
  private let frameQueue = DispatchQueue(label: "io.rootlens.arkit-capture.frame", qos: .userInitiated)
  private let handTracker = HandTracker()

  // Display orientation.
  private var displayOrientation: DisplayOrientation = .portrait
  private let displayOrientationLock = NSLock()

  func setDisplayOrientation(_ orientation: DisplayOrientation) {
    displayOrientationLock.lock()
    displayOrientation = orientation
    displayOrientationLock.unlock()
  }

  private func currentDisplayOrientation() -> DisplayOrientation {
    displayOrientationLock.lock()
    let o = displayOrientation
    displayOrientationLock.unlock()
    return o
  }

  // Latest pixel buffer (for captureSnapshot).
  private var latestPixelBuffer: CVPixelBuffer?
  private let latestBufferLock = NSLock()

  // HandTracker runs on its own queue with a drop-while-busy pattern (no backlog).
  private let handTrackerQueue = DispatchQueue(label: "io.rootlens.arkit-capture.handtracker", qos: .userInitiated)
  private let handTrackerBusyLock = NSLock()
  private var handTrackerBusy = false
  private var handTrackerSkipCount: Int = 0
  private let handTrackerInterval: Int = 4  // ARKit 60 Hz / 4 ≈ 15 Hz

  // Marker scan (printed ROOTLENS QR = deterministic start/stop trigger that works
  // in every capture flow). Same drop-while-busy pattern as HandTracker; only
  // ROOTLENS-prefixed payloads leave this class, so bystander QR codes in the
  // environment are never surfaced.
  private let markerQueue = DispatchQueue(label: "io.rootlens.arkit-capture.marker", qos: .userInitiated)
  private let markerBusyLock = NSLock()
  private var markerBusy = false
  private var markerSkipCount: Int = 0
  private let markerInterval: Int = 8  // ~4 Hz at 30 fps sensor rate

  // Latest HandTracker output, kept to fill the hands field of each
  // frames.jsonl row. HandTracker runs at ~15 Hz while rows are
  // written for every kept frame, so consecutive rows share the latest hands.
  private var latestHandOutput: HandTracker.Output?
  private let latestHandOutputLock = NSLock()

  // Recording state (non-nil only while recording).
  // Stop flag: stopRecording sets this to true across a frameQueue barrier before
  // calling finishWriting. Every later video append on frameQueue bails, so an
  // append can never race finishWriting on another thread and drop the writer
  // into .failed ("The operation couldn't be completed").
  private var finishingWriter = false
  // How many times adaptor.append returned false while recording (diagnostic:
  // did the encoder die mid-recording?).
  private var appendFailCount = 0
  private var writerFailureLogged = false
  // Pool for copies of capturedImage, so async appends never hold ARKit's
  // recycled buffers. Lazily created from the first frame's resolution and
  // format, released when recording ends.
  private var copyPool: CVPixelBufferPool?
  private var copyPoolDims: (w: Int, h: Int, fmt: OSType) = (0, 0, 0)
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var recordingStartTime: CMTime = .invalid
  private var sessionDirURL: URL?
  private var rgbMp4URL: URL?

  // Sensor stream state (non-nil only while recording; output files append incrementally).
  private var sensorsFileHandle: FileHandle?
  private var imuFileHandle: FileHandle?
  // Per-ARFrame streams (every frame while recording, independent of samplers):
  // arkit_imu.jsonl = VIO-pose-derived orientation + angular velocity + tracking,
  // device_metrics.jsonl = battery / thermal / cpu / memory (values cached 500 ms).
  private var arkitImuFileHandle: FileHandle?
  private var deviceMetricsFileHandle: FileHandle?
  private var prevArkitQuat: simd_quatf?
  private var prevArkitTs: Double = -1
  private var metricsCacheTs: Double = -1
  private var metricsCache: [String: Any] = [:]
  // Camera-IMU extrinsic estimator: aligns VIO angular velocity against the gyro
  // stream during normal recording, caches per device model across sessions.
  private lazy var camImuEstimator = CameraImuExtrinsicEstimator(deviceModel: self.currentDeviceModel())

  // Live stream accounting for metadata. Each range is touched from a single
  // queue (rgb/depth/pc on frameQueue, imu on motionQueue, ar frames on main);
  // the stop path reads them after those queues drain.
  private struct StreamRange {
    var firstNs: Int64 = 0
    var lastNs: Int64 = 0
    var count = 0
    mutating func record(_ tsNs: Int64) {
      if count == 0 { firstNs = tsNs }
      lastNs = tsNs
      count += 1
    }
    var durationMs: Int64 { count > 0 ? (lastNs - firstNs) / 1_000_000 : 0 }
  }
  private var rgbRange = StreamRange()
  private var depthRange = StreamRange()
  private var pcRange = StreamRange()
  private var imuRange = StreamRange()
  private var arkitRange = StreamRange()
  // LiDAR depth (sceneDepth) streams into a single depth.tar (see DepthTarWriter).
  private var depthTarWriter: DepthTarWriter?
  private var frameIndexCounter: Int = 0
  private let sensorFileQueue = DispatchQueue(label: "io.rootlens.arkit-capture.sensors", qos: .utility)
  private let motionManager = CMMotionManager()
  private let motionQueue = OperationQueue()

  // MARK: - Capture settings (set from JS; apply from the next startSession / startRecording)

  struct CaptureSettings {
    var resolution = "1440p"        // "1440p" (4:3, widest FoV) | "1080p" | "720p"
    var autoFocus = true
    var autoExposure = true         // false locks exposure once the session settles
    var arkitFps = 30               // requested sensor fps (30/60); the format picker prefers a match
    var recordingRate = 30          // output Hz for RGB / depth / point cloud (15/30/60)
    var syncRate = true             // false applies depthRate / pointCloudRate individually (≤ recordingRate)
    var depthRate = 30
    var pointCloudRate = 30
    var imuRateHz = 100             // 50 / 100 / 200
    var streamImu = true
    var streamDepth = true
    var streamPointCloud = true
    var streamMesh = true
  }

  // Settings are written from the JS bridge thread and read on main / recording
  // queues; the lock keeps the struct copy atomic.
  private let settingsLock = NSLock()
  private var _captureSettings = CaptureSettings()
  private(set) var captureSettings: CaptureSettings {
    get {
      settingsLock.lock()
      defer { settingsLock.unlock() }
      return _captureSettings
    }
    set {
      settingsLock.lock()
      defer { settingsLock.unlock() }
      _captureSettings = newValue
    }
  }

  /// Capture settings from JS (JSON). Apply from the next startSession / startRecording.
  func applyCaptureSettings(json: String) {
    guard let data = json.data(using: .utf8),
          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      NSLog("[ArkitCaptureController] applyCaptureSettings: invalid json")
      return
    }
    var s = CaptureSettings()
    if let v = obj["resolution"] as? String { s.resolution = v }
    if let v = obj["autoFocus"] as? Bool { s.autoFocus = v }
    if let v = obj["autoExposure"] as? Bool { s.autoExposure = v }
    if let v = obj["arkitFps"] as? Int { s.arkitFps = v }
    if let v = obj["recordingRate"] as? Int { s.recordingRate = v }
    if let v = obj["syncRate"] as? Bool { s.syncRate = v }
    if let v = obj["depthRate"] as? Int { s.depthRate = v }
    if let v = obj["pointCloudRate"] as? Int { s.pointCloudRate = v }
    if let v = obj["imuRateHz"] as? Int { s.imuRateHz = v }
    if let v = obj["streamImu"] as? Bool { s.streamImu = v }
    if let v = obj["streamDepth"] as? Bool { s.streamDepth = v }
    if let v = obj["streamPointCloud"] as? Bool { s.streamPointCloud = v }
    if let v = obj["streamMesh"] as? Bool { s.streamMesh = v }
    captureSettings = s
    NSLog("[ArkitCaptureController] capture settings applied: %@", json)
  }

  // Output decimation: one deterministic sampler per stream (see FrameSampler).
  // RGB keeps sampling through tracking loss so the video stays continuous;
  // depth / point cloud sample only while tracking is normal, and their slot
  // grids shift past each outage so recoveries never burst.
  private let rgbSampler = FrameSampler(targetFps: 30)
  private let depthSampler = FrameSampler(targetFps: 30)
  private let pcSampler = FrameSampler(targetFps: 30)
  private var trackingPauseStartTs: Double = -1   // capture timestamp when tracking left .normal
  private var trackingPauseCount = 0
  private var trackingPauseTotalNs: Int64 = 0
  private var recFrameStride = 1        // nominal stride for metadata (sessionFps / recordingRate)
  private var recordingSessionFps: Double = 30.0  // sensor fps captured at startRecording (for metadata)
  private var pointCloudFileHandle: FileHandle?

  // Session running state.
  private var sessionRunning = false

  // Session readiness gate: discard the first frames (world frame still converging),
  // then require a run of consecutive .normal tracking frames before recording may
  // start. Guarantees every session opens on a stabilized coordinate frame.
  private static let skipInitialFrames = 30
  private static let minStableTrackingFrames = 10
  private var readinessFramesSeen = 0
  private var consecutiveNormalFrames = 0
  private(set) var isSessionReady = false

  // Thermal-state log (recording only). events is touched only on sensorFileQueue.
  private var thermalObserver: NSObjectProtocol?
  private var thermalEvents: [[String: Any]] = []
  // Battery level at recording start (0..1, -1 unknown). Recorded with the end
  // level into metadata.json at stop, accumulating real per-recording drain data.
  private var batteryStartLevel: Float = -1

  // Brightness before dimming (restored on undim). Main thread only.
  private var brightnessBeforeDim: CGFloat?

  private override init() {
    super.init()
    session.delegate = self
  }

  // MARK: - Preview attach

  var arSession: ARSession { session }

  /// Sensor resolution of the videoFormat ARKit is using. PreviewView uses it for aspect fitting.
  func currentSensorResolution() -> CGSize {
    if let cf = session.currentFrame { return cf.camera.imageResolution }
    if let cfg = session.configuration as? ARWorldTrackingConfiguration {
      return cfg.videoFormat.imageResolution
    }
    return .zero
  }

  // MARK: - Session lifecycle

  func startSession() {
    if sessionRunning { return }
    let settings = captureSettings
    let config = ARWorldTrackingConfiguration()
    config.worldAlignment = .gravity
    config.planeDetection = [.horizontal, .vertical]
    config.isAutoFocusEnabled = settings.autoFocus
    if settings.streamDepth, ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics.insert(.sceneDepth)
    }
    if settings.streamMesh, ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
    }
    let chosen = pickPreferredFormat(resolution: settings.resolution, requestedFps: settings.arkitFps)
    if let f = chosen {
      config.videoFormat = f
      let isUltra: Bool = {
        if #available(iOS 16.0, *) { return f.captureDeviceType == .builtInUltraWideCamera }
        return false
      }()
      NSLog("[ArkitCaptureController] selected video format: %.0fx%.0f @ %.0f fps, ultrawide=%@",
            f.imageResolution.width, f.imageResolution.height, f.framesPerSecond,
            isUltra ? "yes" : "no")
    } else {
      NSLog("[ArkitCaptureController] using default ARWorldTracking video format")
    }
    readinessFramesSeen = 0
    consecutiveNormalFrames = 0
    isSessionReady = false
    session.run(config)
    sessionRunning = true
    applyExposurePreferenceAfterSettle()
    // ⚠ Keep-awake and screen dim are deliberately not touched here. They belong
    //    to "while the capture screen is open", not to the ARSession's on/off:
    //    during an automatic cycle pause ARKit stops but the screen must not
    //    lock (lock → app suspends → the cycle timers freeze). JS drives them
    //    through setKeepAwake / setScreenDimmed from the capture screen lifecycle.
  }

  /// Locks camera exposure after the session settles, when auto-exposure is off.
  /// The delay lets the initial exposure convergence finish before freezing it.
  private func applyExposurePreferenceAfterSettle() {
    if captureSettings.autoExposure { return }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
      guard let self = self, self.sessionRunning else { return }
      if #available(iOS 16.0, *) {
        guard let device = ARWorldTrackingConfiguration.configurableCaptureDeviceForPrimaryCamera else {
          NSLog("[ArkitCaptureController] exposure lock unavailable (no configurable device)")
          return
        }
        do {
          try device.lockForConfiguration()
          device.exposureMode = .locked
          device.unlockForConfiguration()
          NSLog("[ArkitCaptureController] exposure locked")
        } catch {
          NSLog("[ArkitCaptureController] exposure lock failed: %@", "\(error)")
        }
      }
    }
  }

  func stopSession() {
    if !sessionRunning { return }
    session.pause()
    sessionRunning = false
    isSessionReady = false
    // Drain any in-flight HandTracker work (Vision / ANE) and release the held
    // pixel buffer and hand output, so no ARKit frame IOSurface stays alive
    // after the session pauses and the camera can be re-acquired cleanly.
    handTrackerQueue.sync {}
    latestBufferLock.lock()
    latestPixelBuffer = nil
    latestBufferLock.unlock()
    latestHandOutputLock.lock()
    latestHandOutput = nil
    latestHandOutputLock.unlock()
  }

  // MARK: - Recording lifecycle (all sensor outputs)

  /// Start one capture session. Writes concurrently under sessionDir:
  ///   rgb.mp4                  H.264 via AVAssetWriter (ARFrame.capturedImage)
  ///   frames.jsonl  per-frame camera transform / intrinsics / tracking / hands / IMU snapshot
  ///   imu.jsonl                CMMotionManager samples (~100 Hz)
  ///   metadata.json            device + resolution + intrinsics, written once
  ///   depth.tar / pointcloud.jsonl / mesh.jsonl  on supported devices / settings
  /// stopRecording flushes and closes every handle.
  func startRecording(sessionDir: URL) throws -> URL {
    if assetWriter != nil {
      throw NSError(domain: "ArkitCaptureController", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "already recording"])
    }
    if !isSessionReady {
      throw NSError(domain: "ArkitCaptureController", code: 7,
                    userInfo: [NSLocalizedDescriptionKey: "AR session not ready (tracking not stabilized yet)"])
    }

    try FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)

    // Configure the AVAssetWriter from the sensor resolution.
    let sensorRes = currentSensorResolution()
    let sensorW = Int(sensorRes.width)
    let sensorH = Int(sensorRes.height)
    if sensorW == 0 || sensorH == 0 {
      throw NSError(domain: "ArkitCaptureController", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "sensor resolution unknown"])
    }

    let mp4URL = sessionDir.appendingPathComponent("rgb.mp4")
    try removeIfExists(at: mp4URL)

    let writer = try AVAssetWriter(outputURL: mp4URL, fileType: .mp4)
    // 12 Mbps target (sized for full-sensor 1920x1440; ~450 MB per 5 minutes).
    // Downstream processing re-encodes anyway, so this is not tuned aggressively.
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: sensorW,
      AVVideoHeightKey: sensorH,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 12_000_000,
        AVVideoMaxKeyFrameIntervalKey: 60,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoAllowFrameReorderingKey: false,
      ],
    ]
    // Fragmented MP4 (a moof finalizes every 10 seconds). A regular MP4 only
    // writes its moov at the end, so dying mid-recording loses the whole file;
    // with fragments everything up to the last finalized chunk stays playable
    // (a crash at minute 99 of 100 loses at most 10 seconds).
    writer.movieFragmentInterval = CMTimeMakeWithSeconds(10.0, preferredTimescale: 600)

    let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    input.expectsMediaDataInRealTime = true
    input.transform = currentDisplayOrientation().videoTransform

    let sourcePixelAttrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      kCVPixelBufferWidthKey as String: sensorW,
      kCVPixelBufferHeightKey as String: sensorH,
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: input, sourcePixelBufferAttributes: sourcePixelAttrs)

    guard writer.canAdd(input) else {
      throw NSError(domain: "ArkitCaptureController", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add video input"])
    }
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    // Prepare the sensor stream files (IMU / point cloud only when enabled in settings).
    let sensorsURL = sessionDir.appendingPathComponent("frames.jsonl")
    let imuURL = sessionDir.appendingPathComponent("imu.jsonl")
    let pcURL = sessionDir.appendingPathComponent("pointcloud.jsonl")
    try removeIfExists(at: sensorsURL)
    try removeIfExists(at: imuURL)
    try removeIfExists(at: pcURL)
    try removeIfExists(at: sessionDir.appendingPathComponent("mesh.jsonl"))
    FileManager.default.createFile(atPath: sensorsURL.path, contents: nil)
    let sensorsHandle = try FileHandle(forWritingTo: sensorsURL)
    var imuHandle: FileHandle?
    if captureSettings.streamImu {
      FileManager.default.createFile(atPath: imuURL.path, contents: nil)
      imuHandle = try FileHandle(forWritingTo: imuURL)
    }
    var pcHandle: FileHandle?
    if captureSettings.streamPointCloud {
      FileManager.default.createFile(atPath: pcURL.path, contents: nil)
      pcHandle = try FileHandle(forWritingTo: pcURL)
    }
    let arkitImuURL = sessionDir.appendingPathComponent("arkit_imu.jsonl")
    let metricsURL = sessionDir.appendingPathComponent("device_metrics.jsonl")
    try removeIfExists(at: arkitImuURL)
    try removeIfExists(at: metricsURL)
    FileManager.default.createFile(atPath: arkitImuURL.path, contents: nil)
    FileManager.default.createFile(atPath: metricsURL.path, contents: nil)
    let arkitImuHandle = try FileHandle(forWritingTo: arkitImuURL)
    let metricsHandle = try FileHandle(forWritingTo: metricsURL)

    // Depth streams into depth.tar during recording (lazily created on the first
    // depth frame). Here we only clear any leftovers from a previous run.
    try removeIfExists(at: sessionDir.appendingPathComponent("depth.tar"))
    try removeIfExists(at: sessionDir.appendingPathComponent("depth"))

    // Fix the decimation factors from the session fps and the settings.
    let sessionFps: Double = {
      if let cfg = session.configuration as? ARWorldTrackingConfiguration {
        return Double(cfg.videoFormat.framesPerSecond)
      }
      return 30.0
    }()
    recordingSessionFps = sessionFps
    recFrameStride = max(1, Int((sessionFps / Double(max(1, captureSettings.recordingRate))).rounded())) // nominal value for metadata
    // One deterministic sampler per stream. Depth / point cloud rates cap at the
    // RGB rate (a depth frame without its RGB row has no index to live under).
    let rgbRate = max(1, captureSettings.recordingRate)
    let dRate = captureSettings.syncRate ? rgbRate : min(captureSettings.depthRate, rgbRate)
    let pRate = captureSettings.syncRate ? rgbRate : min(captureSettings.pointCloudRate, rgbRate)
    rgbSampler.configure(targetFps: rgbRate)
    depthSampler.configure(targetFps: max(1, dRate))
    pcSampler.configure(targetFps: max(1, pRate))
    rgbSampler.reset()
    depthSampler.reset()
    pcSampler.reset()
    trackingPauseStartTs = -1
    trackingPauseCount = 0
    trackingPauseTotalNs = 0

    // metadata.json waits for the intrinsics to settle, so it is written on the
    // first frame (camera.intrinsics may be empty until the first didUpdate).

    self.finishingWriter = false
    self.appendFailCount = 0
    self.copyPool = nil
    self.copyPoolDims = (0, 0, 0)
    self.assetWriter = writer
    self.videoInput = input
    self.pixelBufferAdaptor = adaptor
    self.recordingStartTime = .invalid
    self.sessionDirURL = sessionDir
    self.rgbMp4URL = mp4URL
    self.sensorsFileHandle = sensorsHandle
    self.imuFileHandle = imuHandle
    self.pointCloudFileHandle = pcHandle
    self.depthTarWriter = DepthTarWriter(sessionDir: sessionDir)
    self.frameIndexCounter = 0
    self.arkitImuFileHandle = arkitImuHandle
    self.deviceMetricsFileHandle = metricsHandle
    self.prevArkitQuat = nil
    self.prevArkitTs = -1
    self.metricsCacheTs = -1
    self.metricsCache = [:]
    self.rgbRange = StreamRange()
    self.depthRange = StreamRange()
    self.pcRange = StreamRange()
    self.imuRange = StreamRange()
    self.arkitRange = StreamRange()
    UIDevice.current.isBatteryMonitoringEnabled = true

    if !sessionRunning { startSession() }
    handTracker.setRecordingMode(true)
    startMotionUpdates()
    startThermalMonitoring()

    return sessionDir
  }

  /// End the session. Flushes and closes every file. Returns the sessionDir URL.
  func stopRecording() throws -> URL {
    guard let writer = assetWriter, let input = videoInput, let dir = sessionDirURL else {
      throw NSError(domain: "ArkitCaptureController", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "not recording"])
    }
    handTracker.setRecordingMode(false)
    stopMotionUpdates()

    // Drain in-flight video appends on the serial frameQueue and stop any further
    // appends before closing the writer. frameQueue.sync completes every enqueued
    // append before the flag flips, so no append can overlap finishWriting.
    frameQueue.sync { self.finishingWriter = true }

    // Diagnostics: note the writer status before finishWriting. If it is already
    // .failed(3) the encoder died mid-recording; if .writing(1) then finishWriting
    // itself is what failed.
    let preFinishStatus = writer.status.rawValue
    NSLog("[ArkitCaptureController] stopRecording begin: writer.status=%ld framesWritten=%d appendFails=%d free=%lld error=%@",
          preFinishStatus, frameIndexCounter, appendFailCount, Self.freeDiskBytes(),
          Self.describeNSError(writer.error))

    input.markAsFinished()
    let group = DispatchGroup()
    group.enter()
    writer.finishWriting {
      group.leave()
    }
    group.wait()

    NSLog("[ArkitCaptureController] finishWriting done: status=%ld error=%@",
          Int(writer.status.rawValue), Self.describeNSError(writer.error))

    // Sensor files are written on sensorFileQueue, so wait for its flush before
    // closing. Skipping the sync truncates data mid-line (corrupt output), so a
    // failure here always throws to the caller.
    var sensorCloseError: Error?
    sensorFileQueue.sync {
      do {
        self.depthTarWriter?.finalize()  // tar trailer (2×512 zero blocks) + close (no-op without depth)
        try self.sensorsFileHandle?.synchronize()
        try self.sensorsFileHandle?.close()
        try self.imuFileHandle?.synchronize()
        try self.imuFileHandle?.close()
        try self.pointCloudFileHandle?.synchronize()
        try self.pointCloudFileHandle?.close()
        try self.arkitImuFileHandle?.synchronize()
        try self.arkitImuFileHandle?.close()
        try self.deviceMetricsFileHandle?.synchronize()
        try self.deviceMetricsFileHandle?.close()
      } catch {
        sensorCloseError = error
      }
    }

    // Export the scene mesh (ARMeshAnchors) to mesh.jsonl (only when enabled and on LiDAR devices).
    if captureSettings.streamMesh {
      let meshAnchors = (session.currentFrame?.anchors ?? []).compactMap { $0 as? ARMeshAnchor }
      MeshExporter.writeMeshJsonl(anchors: meshAnchors, into: dir)
    }

    stopThermalMonitoring(mergingInto: dir)
    mergeEstimatorMetadata(into: dir)

    // Capture diagnostics before resetting (they go into the error message on
    // failure; the unified log redacts NSLog as <private>, so the real OSStatus
    // must travel in the thrown message to reach JS and the screen).
    let framesWritten = self.frameIndexCounter
    let freeMB = Self.freeDiskBytes() / 1_000_000

    self.assetWriter = nil
    self.videoInput = nil
    self.pixelBufferAdaptor = nil
    self.recordingStartTime = .invalid
    self.sessionDirURL = nil
    self.rgbMp4URL = nil
    self.sensorsFileHandle = nil
    self.imuFileHandle = nil
    self.pointCloudFileHandle = nil
    self.arkitImuFileHandle = nil
    self.deviceMetricsFileHandle = nil
    self.depthTarWriter = nil
    self.frameIndexCounter = 0
    self.writerFailureLogged = false
    self.copyPool = nil
    self.copyPoolDims = (0, 0, 0)

    if writer.status == .failed {
      // Root cause (AVFoundation code + underlying OSStatus) plus frame count and
      // free disk, for triaging fragment-boundary encoder failures (-16341 etc.).
      let e = writer.error as NSError?
      let u = e?.userInfo[NSUnderlyingErrorKey] as? NSError
      let diag = "av=\(e.map { "\($0.domain):\($0.code)" } ?? "nil")"
        + " under=\(u.map { "\($0.domain):\($0.code)" } ?? "-")"
        + " pre=\(preFinishStatus) appFail=\(appendFailCount)"
        + " frames=\(framesWritten) free=\(freeMB)MB"

      // The MP4 is fragmented (movieFragmentInterval = 10s), so even when the
      // writer fails, everything up to the last fragment is committed to disk.
      // If enough frames were written and the file exists, salvage the recording
      // instead of discarding it. The missing tail is absorbed by downstream
      // re-encoding, and the user previews the clip before uploading.
      let mp4Path = dir.appendingPathComponent("rgb.mp4").path
      let mp4Size = ((try? FileManager.default.attributesOfItem(atPath: mp4Path))?[.size] as? Int) ?? 0
      if framesWritten > 30, mp4Size > 1_000_000 {
        NSLog("[ArkitCaptureController] finishWriting failed; salvaged fragmented mp4 (%d bytes). %@",
              mp4Size, diag)
        return dir
      }
      // Only report failure when there is nothing worth salvaging (nearly empty).
      NSLog("[ArkitCaptureController] finishWriting failed, unsalvageable. %@", diag)
      throw NSError(domain: "ArkitCaptureController", code: 5,
                    userInfo: [NSLocalizedDescriptionKey: diag])
    }
    if let sensorCloseError {
      throw NSError(domain: "ArkitCaptureController", code: 6,
                    userInfo: [
                      NSLocalizedDescriptionKey: "sensor file close failed: \(sensorCloseError.localizedDescription)",
                      NSUnderlyingErrorKey: sensorCloseError,
                    ])
    }
    return dir
  }

  /// Merge everything only the stop path knows into metadata.json: the extrinsic
  /// estimate (exists ~20 s into the session), the labeled IMU noise model, and
  /// the per-stream accounting (counts, time ranges, expected slots, pauses).
  private func mergeEstimatorMetadata(into dir: URL) {
    let url = dir.appendingPathComponent("metadata.json")
    guard let data = try? Data(contentsOf: url),
          var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      NSLog("[ArkitCaptureController] estimator metadata merge skipped (metadata.json unreadable)")
      return
    }
    if let r = camImuEstimator.finalizedResult() ?? camImuEstimator.cachedValue() {
      obj["camera_imu_extrinsic"] = [
        "rotation_matrix_3x3": r.rotationRowMajor,
        "translation_xyz_m": [r.translationXYZ.x, r.translationXYZ.y, r.translationXYZ.z],
        "translation_source": r.translationSource.rawValue,
        "estimation_method": r.estimationMethod,
        "calibration_window_s": r.calibrationWindowS,
        "rotation_residual_median_rad_s": r.rotationResidualMedianRadS,
        "translation_residual_median_m_s2": r.translationResidualMedianMS2,
        "rotation_samples": r.rotationSamples,
        "drift_vs_cache_deg": r.driftVsCacheDeg,
        "from_cache": r.fromCache,
      ] as [String: Any]
    }
    obj["imu_intrinsics"] = [
      "accel_noise_density": 2.0e-3,
      "gyro_noise_density": 1.5e-4,
      "accel_bias_random_walk": 5.0e-5,
      "gyro_bias_random_walk": 1.0e-5,
      "sample_rate_hz": captureSettings.imuRateHz,
      "source": "static_defaults",
    ] as [String: Any]
    obj["total_rgb_frames"] = rgbRange.count
    obj["total_depth_frames"] = depthRange.count
    obj["total_pointcloud_frames"] = pcRange.count
    obj["total_imu_samples"] = imuRange.count
    obj["total_ar_frames"] = arkitRange.count
    obj["rgb_append_fail_count"] = appendFailCount
    obj["rgb_expected_frame_slots"] = rgbSampler.totalExpectedFrameCount
    obj["depth_expected_frame_slots"] = depthSampler.totalExpectedFrameCount
    obj["pointcloud_expected_frame_slots"] = pcSampler.totalExpectedFrameCount
    obj["tracking_pause_count"] = trackingPauseCount
    obj["tracking_pause_total_offset_ms"] = trackingPauseTotalNs / 1_000_000
    obj["sampling_strategy"] = "timestamp_gate"
    obj["sampling_strategy_detail"] = "deterministic_frame_schedule"
    obj["arkit_native_fps"] = recordingSessionFps
    obj["rgb_start_ns"] = rgbRange.firstNs
    obj["rgb_end_ns"] = rgbRange.lastNs
    obj["imu_start_ns"] = imuRange.firstNs
    obj["imu_end_ns"] = imuRange.lastNs
    obj["depth_start_ns"] = depthRange.firstNs
    obj["depth_end_ns"] = depthRange.lastNs
    obj["pointcloud_start_ns"] = pcRange.firstNs
    obj["pointcloud_end_ns"] = pcRange.lastNs
    obj["stream_durations_ms"] = [
      "rgb": rgbRange.durationMs,
      "imu": imuRange.durationMs,
      "depth": depthRange.durationMs,
      "pointcloud": pcRange.durationMs,
      "ar_frames": arkitRange.durationMs,
    ] as [String: Any]
    do {
      let out = try JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys])
      try out.write(to: url, options: .atomic)
    } catch {
      NSLog("[ArkitCaptureController] estimator metadata merge failed: %@", "\(error)")
    }
  }

  // MARK: - Per-ARFrame streams (arkit_imu.jsonl / device_metrics.jsonl)

  /// Append one row per ARFrame to both per-frame streams. The orientation is the
  /// VIO camera rotation; angular velocity comes from the quaternion delta between
  /// consecutive frames. Metric values refresh every 500 ms; timestamps are always
  /// the frame's own.
  private func appendPerFrameStreams(frame: ARFrame, timestamp: Double) {
    let tsNs = Int64(timestamp * 1_000_000_000.0)
    arkitRange.record(tsNs)
    let t = frame.camera.transform
    var qNow = simd_quatf(simd_float3x3(
      simd_make_float3(t.columns.0.x, t.columns.0.y, t.columns.0.z),
      simd_make_float3(t.columns.1.x, t.columns.1.y, t.columns.1.z),
      simd_make_float3(t.columns.2.x, t.columns.2.y, t.columns.2.z)))
    // Hemisphere continuity: q and -q encode the same rotation; align with the
    // previous frame so the written orientation sequence never flips sign.
    if let qPrev = prevArkitQuat, simd_dot(qPrev.vector, qNow.vector) < 0 {
      qNow = simd_quatf(vector: -qNow.vector)
    }
    var wx = 0.0
    var wy = 0.0
    var wz = 0.0
    if let qPrev = prevArkitQuat, timestamp > prevArkitTs, prevArkitTs > 0 {
      let dt = timestamp - prevArkitTs
      // Shortest arc: q and -q encode the same rotation, so align hemispheres
      // first or a matrix-to-quaternion branch change reads as a ~2pi spin.
      let qPrevAligned = simd_dot(qPrev.vector, qNow.vector) < 0
        ? simd_quatf(vector: -qPrev.vector) : qPrev
      // Body-frame delta (q_prev^-1 * q_now): angular velocity in the camera
      // frame, matching the stream's frame_id and comparable to a gyro.
      let qDelta = simd_normalize(simd_inverse(qPrevAligned) * qNow)
      let angle = Double(qDelta.angle)
      if abs(angle) >= 1e-6 {
        let axis = simd_normalize(qDelta.axis)
        let scale = angle / dt
        wx = Double(axis.x) * scale
        wy = Double(axis.y) * scale
        wz = Double(axis.z) * scale
      }
    }
    prevArkitQuat = qNow
    prevArkitTs = timestamp

    let poseVec: [Float] = [t.columns.3.x, t.columns.3.y, t.columns.3.z,
                            qNow.imag.x, qNow.imag.y, qNow.imag.z, qNow.real]
    camImuEstimator.pushCameraPose(timestampNs: tsNs, pose: poseVec)
    if let solved = camImuEstimator.maybeFinalize(currentTimestampNs: tsNs) {
      NSLog("[ArkitCaptureController] camera-IMU extrinsic finalized: residual=%.4f rad/s samples=%d window=%.1fs drift=%.2fdeg",
            solved.rotationResidualMedianRadS, solved.rotationSamples,
            solved.calibrationWindowS, solved.driftVsCacheDeg)
    }

    let trackingPair = describeTrackingState(frame.camera.trackingState)
    let arkitRow: [String: Any] = [
      "timestamp_ns": tsNs,
      "qx": Double(qNow.imag.x), "qy": Double(qNow.imag.y),
      "qz": Double(qNow.imag.z), "qw": Double(qNow.real),
      "wx": wx, "wy": wy, "wz": wz,
      "tracking_state": arkitTrackingStateInt(frame.camera.trackingState),
      "tracking_reason": trackingPair.reason,
    ]

    if timestamp - metricsCacheTs >= 0.5 || metricsCache.isEmpty {
      metricsCacheTs = timestamp
      let device = UIDevice.current
      let thermal = ProcessInfo.processInfo.thermalState
      metricsCache = [
        "battery_level": Double(device.batteryLevel),
        "battery_state": device.batteryState.rawValue,
        "battery_state_str": Self.batteryStateString(device.batteryState),
        "cpu_usage": currentCpuUsage(),
        "memory_used_mb": currentFootprintMB(),
        "memory_available_mb": availableMemoryMB(),
        "thermal_state": thermal.rawValue,
        "thermal_state_str": Self.thermalStateString(thermal),
        "device_model": currentDeviceModel(),
      ]
    }
    var metricsRow = metricsCache
    metricsRow["timestamp_ns"] = tsNs

    let arkitHandle = arkitImuFileHandle
    let metricsHandle = deviceMetricsFileHandle
    if arkitHandle == nil && metricsHandle == nil { return }
    sensorFileQueue.async {
      func writeLine(_ handle: FileHandle?, _ dict: [String: Any], _ name: String) {
        guard let handle = handle else { return }
        do {
          let data = try JSONSerialization.data(withJSONObject: dict, options: [])
          try handle.write(contentsOf: data)
          try handle.write(contentsOf: Data("\n".utf8))
        } catch {
          NSLog("[ArkitCaptureController] %@ write failed: %@", name, "\(error)")
        }
      }
      writeLine(arkitHandle, arkitRow, "arkit_imu.jsonl")
      writeLine(metricsHandle, metricsRow, "device_metrics.jsonl")
    }
  }

  static func batteryStateString(_ s: UIDevice.BatteryState) -> String {
    switch s {
    case .unplugged: return "unplugged"
    case .charging:  return "charging"
    case .full:      return "full"
    case .unknown:   return "unknown"
    @unknown default: return "unknown"
    }
  }

  /// Sum of per-thread cpu_usage for this process (1.0 = one full core).
  private func currentCpuUsage() -> Double {
    var threadsList: thread_act_array_t?
    var threadsCount = mach_msg_type_number_t(0)
    guard task_threads(mach_task_self_, &threadsList, &threadsCount) == KERN_SUCCESS,
          let list = threadsList else { return 0 }
    defer {
      vm_deallocate(mach_task_self_, vm_address_t(UInt(bitPattern: list)),
                    vm_size_t(Int(threadsCount) * MemoryLayout<thread_t>.stride))
    }
    var total: Double = 0
    for i in 0..<Int(threadsCount) {
      var info = thread_basic_info()
      var count = mach_msg_type_number_t(MemoryLayout<thread_basic_info>.size / MemoryLayout<integer_t>.size)
      let kr = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
          thread_info(list[i], thread_flavor_t(THREAD_BASIC_INFO), $0, &count)
        }
      }
      if kr == KERN_SUCCESS, info.flags & TH_FLAGS_IDLE == 0 {
        total += Double(info.cpu_usage) / Double(TH_USAGE_SCALE)
      }
    }
    return total
  }

  /// Resident footprint (phys_footprint) in MB.
  private func currentFootprintMB() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let kr = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count)
      }
    }
    guard kr == KERN_SUCCESS else { return 0 }
    return Double(info.phys_footprint) / (1024.0 * 1024.0)
  }

  /// Memory the OS would still grant this process, in MB.
  private func availableMemoryMB() -> Double {
    return Double(os_proc_available_memory()) / (1024.0 * 1024.0)
  }

  // MARK: - Thermal monitoring (the long-recording safety valve)

  static func thermalStateString(_ s: ProcessInfo.ThermalState) -> String {
    switch s {
    case .nominal:  return "nominal"
    case .fair:     return "fair"
    case .serious:  return "serious"
    case .critical: return "critical"
    @unknown default: return "unknown"
    }
  }

  /// Nanoseconds on the same clock as ARFrame.timestamp (systemUptime), so thermal events align with the frame stream.
  private static func uptimeNs() -> Int64 {
    Int64(ProcessInfo.processInfo.systemUptime * 1_000_000_000.0)
  }

  private func startThermalMonitoring() {
    let initial = ProcessInfo.processInfo.thermalState
    sensorFileQueue.async {
      self.thermalEvents = [["timestamp_ns": Self.uptimeNs(),
                             "state": Self.thermalStateString(initial)]]
    }
    DispatchQueue.main.async {
      UIDevice.current.isBatteryMonitoringEnabled = true
      self.batteryStartLevel = UIDevice.current.batteryLevel
    }
    thermalObserver = NotificationCenter.default.addObserver(
      forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: nil
    ) { [weak self] _ in
      guard let self = self else { return }
      let str = Self.thermalStateString(ProcessInfo.processInfo.thermalState)
      NSLog("[ArkitCaptureController] thermal state -> %@", str)
      self.sensorFileQueue.async {
        self.thermalEvents.append(["timestamp_ns": Self.uptimeNs(), "state": str])
      }
      self.delegate?.arkitCapture(didChangeThermalState: str)
    }
  }

  /// Stop monitoring and merge the thermal transitions (thermal_events) and the
  /// measured battery drain into metadata.json (which was written on the first
  /// frame, hence read-modify-write).
  private func stopThermalMonitoring(mergingInto dir: URL) {
    if let obs = thermalObserver {
      NotificationCenter.default.removeObserver(obs)
      thermalObserver = nil
    }
    var events: [[String: Any]] = []
    sensorFileQueue.sync { events = self.thermalEvents; self.thermalEvents = [] }
    var endLevel: Float = -1
    DispatchQueue.main.sync { endLevel = UIDevice.current.batteryLevel }
    let url = dir.appendingPathComponent("metadata.json")
    guard let data = try? Data(contentsOf: url),
          var obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      NSLog("[ArkitCaptureController] metadata.json not readable, thermal_events dropped")
      return
    }
    if !events.isEmpty { obj["thermal_events"] = events }
    obj["battery"] = ["start_level": batteryStartLevel, "end_level": endLevel]
    batteryStartLevel = -1
    if let out = try? JSONSerialization.data(withJSONObject: obj, options: [.prettyPrinted, .sortedKeys]) {
      try? out.write(to: url, options: .atomic)
    }
  }

  // MARK: - Screen dim (power / heat relief for long recordings; call on the main thread)

  /// Brightness to zero and preview rendering paused (undim restores the previous
  /// brightness). On OLED, black means the pixels are off. Recording, sensor
  /// writing, and audio are unaffected.
  func setScreenDimmed(_ dimmed: Bool) {
    if dimmed {
      if brightnessBeforeDim == nil { brightnessBeforeDim = UIScreen.main.brightness }
      UIScreen.main.brightness = 0.0
    } else if let b = brightnessBeforeDim {
      UIScreen.main.brightness = b
      brightnessBeforeDim = nil
    }
    NotificationCenter.default.post(name: .rootlensPreviewDim, object: nil, userInfo: ["dimmed": dimmed])
  }

  /// Suppress auto-lock (the idle timer). true for the whole time the capture
  /// screen is open, including recording, calibration, and cycle pauses.
  /// ⚠ Independent of the ARSession: even when a pause stops ARKit, the screen
  ///    must not lock while the capture screen is up (lock → app suspends → the
  ///    cycle's pause timers freeze).
  func setKeepAwake(_ on: Bool) {
    UIApplication.shared.isIdleTimerDisabled = on
  }

  /// Deep-copy capturedImage (one of ARKit's recycled buffers) into independent
  /// memory.
  /// ⚠ Called on the delegate queue while the buffer is still valid. Handing the
  ///    copy to the async append means ARKit's pooled buffer is never held across
  ///    an async boundary; holding it starves the pool, breaks the session, and
  ///    fails the writer with -11800 / -163xx (confirmed root cause of -16341).
  private func copyPixelBuffer(_ src: CVPixelBuffer) -> CVPixelBuffer? {
    let w = CVPixelBufferGetWidth(src)
    let h = CVPixelBufferGetHeight(src)
    let fmt = CVPixelBufferGetPixelFormatType(src)
    if copyPool == nil || copyPoolDims != (w, h, fmt) {
      let pbAttrs: [String: Any] = [
        kCVPixelBufferPixelFormatTypeKey as String: fmt,
        kCVPixelBufferWidthKey as String: w,
        kCVPixelBufferHeightKey as String: h,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:],
      ]
      let poolAttrs: [String: Any] = [kCVPixelBufferPoolMinimumBufferCountKey as String: 4]
      var pool: CVPixelBufferPool?
      guard CVPixelBufferPoolCreate(nil, poolAttrs as CFDictionary, pbAttrs as CFDictionary, &pool) == kCVReturnSuccess else {
        return nil
      }
      copyPool = pool
      copyPoolDims = (w, h, fmt)
    }
    guard let pool = copyPool else { return nil }
    var dstOpt: CVPixelBuffer?
    guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &dstOpt) == kCVReturnSuccess, let dst = dstOpt else {
      return nil
    }
    CVPixelBufferLockBaseAddress(src, .readOnly)
    CVPixelBufferLockBaseAddress(dst, [])
    defer {
      CVPixelBufferUnlockBaseAddress(dst, [])
      CVPixelBufferUnlockBaseAddress(src, .readOnly)
    }
    let planeCount = CVPixelBufferGetPlaneCount(src)
    if planeCount == 0 {
      guard let s = CVPixelBufferGetBaseAddress(src), let d = CVPixelBufferGetBaseAddress(dst) else { return nil }
      let sbpr = CVPixelBufferGetBytesPerRow(src)
      let dbpr = CVPixelBufferGetBytesPerRow(dst)
      let n = min(sbpr, dbpr)
      for row in 0..<CVPixelBufferGetHeight(src) { memcpy(d + row * dbpr, s + row * sbpr, n) }
    } else {
      for p in 0..<planeCount {
        guard let s = CVPixelBufferGetBaseAddressOfPlane(src, p),
              let d = CVPixelBufferGetBaseAddressOfPlane(dst, p) else { return nil }
        let ph = CVPixelBufferGetHeightOfPlane(src, p)
        let sbpr = CVPixelBufferGetBytesPerRowOfPlane(src, p)
        let dbpr = CVPixelBufferGetBytesPerRowOfPlane(dst, p)
        if sbpr == dbpr {
          memcpy(d, s, ph * sbpr)
        } else {
          let n = min(sbpr, dbpr)
          for row in 0..<ph { memcpy(d + row * dbpr, s + row * sbpr, n) }
        }
      }
    }
    return dst
  }

  /// Stringify an NSError for diagnostics (domain / code / underlying / failure
  /// reason). The generic localizedDescription ("The operation couldn't be
  /// completed") hides the real cause.
  static func describeNSError(_ error: Error?) -> String {
    guard let e = error as NSError? else { return "nil" }
    var s = "domain=\(e.domain) code=\(e.code) desc=\(e.localizedDescription)"
    if let reason = e.userInfo[NSLocalizedFailureReasonErrorKey] as? String {
      s += " | reason=\(reason)"
    }
    if let u = e.userInfo[NSUnderlyingErrorKey] as? NSError {
      s += " | underlying: domain=\(u.domain) code=\(u.code) desc=\(u.localizedDescription)"
    }
    return s
  }

  /// Free space (bytes) under the app home. Diagnoses whether a failure is disk-full.
  private static func freeDiskBytes() -> Int64 {
    let attrs = try? FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory())
    return (attrs?[.systemFreeSize] as? NSNumber)?.int64Value ?? -1
  }

  /// No-op when absent, throwing removal when present. Used instead of try?.
  private func removeIfExists(at url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  // MARK: - sensor JSONL writers

  /// Start CMMotionManager at the configured rate, appending to imu.jsonl.
  private func startMotionUpdates() {
    guard motionManager.isDeviceMotionAvailable else {
      NSLog("[ArkitCaptureController] CMDeviceMotion unavailable, skipping imu_high_rate")
      return
    }
    motionManager.deviceMotionUpdateInterval = 1.0 / Double(max(1, captureSettings.imuRateHz))
    motionQueue.name = "io.rootlens.arkit-capture.imu"
    motionQueue.maxConcurrentOperationCount = 1
    motionQueue.qualityOfService = .userInteractive
    // Attitude reference is pinned explicitly: x arbitrary, z gravity-aligned.
    motionManager.startDeviceMotionUpdates(using: .xArbitraryZVertical, to: motionQueue) { [weak self] motion, _ in
      guard let self = self, let m = motion else { return }
      self.appendImuLine(motion: m)
    }
  }

  private func stopMotionUpdates() {
    if motionManager.isDeviceMotionActive {
      motionManager.stopDeviceMotionUpdates()
    }
  }

  /// Build the hands array from the latest HandTracker output:
  /// `[{handedness, confidence, landmarks:[{x,y,confidence}×21]}]`. Empty when nothing is detected.
  private func buildHandsArray() -> [[String: Any]] {
    latestHandOutputLock.lock()
    let out = latestHandOutput
    latestHandOutputLock.unlock()
    guard let ht = out else { return [] }
    var hands: [[String: Any]] = []
    for ch in ht.classification.hands where ch.isWearer {
      let lms: [[String: Float]] = ch.raw.landmarks.map { lm in
        ["x": lm.x, "y": lm.y, "confidence": lm.confidence]
      }
      hands.append([
        "handedness": ch.raw.handedness,
        "confidence": ch.raw.confidence,
        "landmarks": lms,
      ])
    }
    return hands
  }

  /// Everything one frames.jsonl row needs, captured from the ARFrame
  /// on the delegate thread while the frame is valid. Holding this instead of
  /// the ARFrame keeps ARKit's pooled camera buffers out of async code; only the
  /// small depth buffers and the immutable feature-point snapshot ride along
  /// (the same objects the previous code already passed across queues).
  private struct FrameRowData {
    let tsNs: Int64
    let transformRows: [[Float]]
    let intrinsics: [Float]
    let trackingStateInt: Int
    let trackingReason: String
    let imu: [String: Any]
    let imageResolution: CGSize
    let depthMap: CVPixelBuffer?
    let confidenceMap: CVPixelBuffer?
    let depthDims: (w: Int, h: Int)?
    let pointCloud: ARPointCloud?
  }

  /// Capture the row data on the delegate thread (the ARFrame must still be valid).
  private func makeFrameRowData(frame: ARFrame, keepDepth: Bool, keepPc: Bool) -> FrameRowData {
    let ts = frame.timestamp
    let t = frame.camera.transform        // simd_float4x4 (= column-major)
    let k = frame.camera.intrinsics       // simd_float3x3
    let trackingPair = describeTrackingState(frame.camera.trackingState)

    // Column-major simd → row-major [[Float; 4]; 4].
    let row0 = [t.columns.0[0], t.columns.1[0], t.columns.2[0], t.columns.3[0]]
    let row1 = [t.columns.0[1], t.columns.1[1], t.columns.2[1], t.columns.3[1]]
    let row2 = [t.columns.0[2], t.columns.1[2], t.columns.2[2], t.columns.3[2]]
    let row3 = [t.columns.0[3], t.columns.1[3], t.columns.2[3], t.columns.3[3]]

    // Row-major 3×3 flattened to 9 elements.
    let intr: [Float] = [
      k.columns.0[0], k.columns.1[0], k.columns.2[0],
      k.columns.0[1], k.columns.1[1], k.columns.2[1],
      k.columns.0[2], k.columns.1[2], k.columns.2[2],
    ]

    // IMU snapshot (latest CMDeviceMotion), same schema as imu.jsonl:
    //   accel = userAccel + gravity, gyro = rotationRate.
    let imuDict: [String: Any]
    if let m = motionManager.deviceMotion {
      imuDict = [
        "accel": [
          "x": m.userAcceleration.x + m.gravity.x,
          "y": m.userAcceleration.y + m.gravity.y,
          "z": m.userAcceleration.z + m.gravity.z,
        ],
        "gyro": ["x": m.rotationRate.x, "y": m.rotationRate.y, "z": m.rotationRate.z],
      ]
    } else {
      imuDict = [:]
    }

    // Depth / point cloud are captured only when their sampler kept this frame.
    let depth = keepDepth ? frame.sceneDepth : nil
    let depthDims: (w: Int, h: Int)? = depth.map {
      (CVPixelBufferGetWidth($0.depthMap), CVPixelBufferGetHeight($0.depthMap))
    }

    return FrameRowData(
      tsNs: Int64(ts * 1_000_000_000.0),
      transformRows: [row0, row1, row2, row3],
      intrinsics: intr,
      trackingStateInt: arkitTrackingStateInt(frame.camera.trackingState),
      trackingReason: trackingPair.reason,
      imu: imuDict,
      imageResolution: frame.camera.imageResolution,
      depthMap: depth?.depthMap,
      confidenceMap: depth?.confidenceMap,
      depthDims: depthDims,
      pointCloud: keepPc ? frame.rawFeaturePoints : nil
    )
  }

  /// Write one frames.jsonl row plus the depth / point-cloud entries
  /// that share its frame index. Called on frameQueue, strictly after the
  /// matching video frame was appended to the mp4: the converter pairs mp4
  /// frames with rows by index, so a row whose frame never made it into the
  /// video would silently shift every later RGB timestamp.
  /// Also writes metadata.json exactly once, on the first row.
  private func writeSensorsLine(_ row: FrameRowData) {
    guard let handle = sensorsFileHandle else { return }
    let frameIndex = frameIndexCounter
    frameIndexCounter += 1
    rgbRange.record(row.tsNs)

    // Row schema:
    //   timestamp_ns: int (seconds × 1e9)
    //   tracking_state: int (ARKit enum value; normal = 2)
    let line: [String: Any] = [
      "frame_index": frameIndex,
      "timestamp_ns": row.tsNs,
      "tracking_state": row.trackingStateInt,
      "tracking_reason": row.trackingReason,
      "camera_transform": row.transformRows,
      "camera_intrinsics": row.intrinsics,
      "imu": row.imu,
      "hands": buildHandsArray(),  // latest HandTracker output
    ]

    sensorFileQueue.async {
      do {
        let data = try JSONSerialization.data(withJSONObject: line, options: [])
        // NSFileHandle.write(_:) throws an ObjC exception on EAGAIN and friends
        // (NSFileHandleOperationException), which Swift do/try/catch cannot catch,
        // crashing outright. The throwing write(contentsOf:) (iOS 13.4+) surfaces
        // it as a catchable Swift error.
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] frames.jsonl write failed: %@", "\(error)")
      }
    }

    // Write metadata.json once, on the first row.
    if frameIndex == 0, let dir = sessionDirURL {
      writeMetadataJson(into: dir, row: row)
    }

    // LiDAR depth (devices with sceneDepth only). Each frame becomes a standard
    // 16-bit PNG (millimeters) stream-appended into depth.tar; one tar uploads in
    // place of tens of thousands of loose PNGs, and extracting it yields the
    // conventional RGB-D depth/ layout (depth/<frameIndex:06>.png). The same
    // frame's confidence map (sceneDepth.confidenceMap: 0=low / 1=medium /
    // 2=high) sits beside it as confidence/<frameIndex:06>.png (8-bit), so a
    // consumer can mask low-confidence pixels. Rate selection already happened in
    // the delegate (depth sampler); a row carries buffers only when it was kept.
    if let depthMap = row.depthMap {
      depthRange.record(row.tsNs)
      let confBuffer = row.confidenceMap
      let idx = frameIndex
      sensorFileQueue.async {
        self.depthTarWriter?.append(depthMap: depthMap, confidenceMap: confBuffer, frameIndex: idx)
      }
    }

    // Feature points (ARKit VIO's rawFeaturePoints), one row per frame in
    // pointcloud.jsonl: xyz as float32 LE and ids as uint64 LE, base64-encoded.
    // Coordinates are in world space, so accumulating rows yields a map.
    if let pcHandle = pointCloudFileHandle,
       let cloud = row.pointCloud,
       !cloud.points.isEmpty {
      pcRange.record(row.tsNs)
      var pts = [Float]()
      pts.reserveCapacity(cloud.points.count * 3)
      for pt in cloud.points {
        pts.append(pt.x); pts.append(pt.y); pts.append(pt.z)
      }
      let ptsData = pts.withUnsafeBufferPointer { Data(buffer: $0) }
      let ids = cloud.identifiers
      let idsData = ids.withUnsafeBufferPointer { Data(buffer: $0) }
      let pcLine: [String: Any] = [
        "frame_index": frameIndex,
        "timestamp_ns": row.tsNs,
        "count": cloud.points.count,
        "points_b64": ptsData.base64EncodedString(),
        "ids_b64": idsData.base64EncodedString(),
      ]
      sensorFileQueue.async {
        do {
          let data = try JSONSerialization.data(withJSONObject: pcLine, options: [])
          try pcHandle.write(contentsOf: data)
          try pcHandle.write(contentsOf: Data("\n".utf8))
        } catch {
          NSLog("[ArkitCaptureController] pointcloud.jsonl write failed: %@", "\(error)")
        }
      }
    }
  }


  private func appendImuLine(motion: CMDeviceMotion) {
    guard let handle = imuFileHandle else { return }
    // Row schema:
    //   timestamp_ns: int
    //   accel: {x, y, z}    userAccel + gravity (absolute acceleration, gravity included)
    //   gyro:  {x, y, z}    rotationRate
    //   device_motion: {attitude, user_accel, gravity, rotation_rate}
    let tsNs: Int64 = Int64(motion.timestamp * 1_000_000_000.0)
    imuRange.record(tsNs)
    camImuEstimator.pushGyroSamples([GyroSample(
      timestampNs: tsNs,
      gyroX: Float(motion.rotationRate.x),
      gyroY: Float(motion.rotationRate.y),
      gyroZ: Float(motion.rotationRate.z))])
    let line: [String: Any] = [
      "timestamp_ns": tsNs,
      "accel": [
        "x": motion.userAcceleration.x + motion.gravity.x,
        "y": motion.userAcceleration.y + motion.gravity.y,
        "z": motion.userAcceleration.z + motion.gravity.z,
      ],
      "gyro": [
        "x": motion.rotationRate.x,
        "y": motion.rotationRate.y,
        "z": motion.rotationRate.z,
      ],
      "device_motion": [
        "attitude": [
          "qx": motion.attitude.quaternion.x,
          "qy": motion.attitude.quaternion.y,
          "qz": motion.attitude.quaternion.z,
          "qw": motion.attitude.quaternion.w,
        ],
        "user_accel": ["x": motion.userAcceleration.x, "y": motion.userAcceleration.y, "z": motion.userAcceleration.z],
        "gravity": ["x": motion.gravity.x, "y": motion.gravity.y, "z": motion.gravity.z],
        "rotation_rate": ["x": motion.rotationRate.x, "y": motion.rotationRate.y, "z": motion.rotationRate.z],
      ],
    ]
    sensorFileQueue.async {
      do {
        let data = try JSONSerialization.data(withJSONObject: line, options: [])
        // Same as above: the throwing write turns ObjC exceptions into Swift errors.
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] imu.jsonl write failed: %@", "\(error)")
      }
    }
  }

  /// metadata.json: static facts that never change within a session
  /// (recording_config / device_model / os / app_version / camera / capture
  /// settings), with the camera intrinsics (fx/fy/cx/cy) and, on LiDAR devices,
  /// the depth intrinsics. calibration_baseline is reserved for the capture UI's
  /// calibration step and stays null here.
  private func writeMetadataJson(into dir: URL, row: FrameRowData) {
    let url = dir.appendingPathComponent("metadata.json")
    // Row-major flat intrinsics: [fx 0 cx / 0 fy cy / 0 0 1].
    let fx = row.intrinsics[0]
    let fy = row.intrinsics[4]
    let cx = row.intrinsics[2]
    let cy = row.intrinsics[5]
    let res = row.imageResolution
    let fps = recordingSessionFps
    // Horizontal FoV (degrees) = 2·atan(width / (2·fx))
    let fovDeg = res.width > 0 && fx > 0
      ? Double(2.0 * atan(Float(res.width) / (2.0 * fx)) * 180.0 / .pi)
      : 0.0
    let info = Bundle.main.infoDictionary
    let appVer = (info?["CFBundleShortVersionString"] as? String ?? "?")
    let appBuild = (info?["CFBundleVersion"] as? String ?? "?")

    var camera: [String: Any] = [
      "lens": "wide",
      "field_of_view_deg": fovDeg,
      "width": Int(res.width),
      "height": Int(res.height),
      "fps": fps,
      "fx": fx, "fy": fy, "cx": cx, "cy": cy,
    ]
    // On LiDAR devices, include the depth resolution and intrinsics.
    if let (dW, dH) = row.depthDims {
      let sx = Float(dW) / Float(res.width)
      let sy = Float(dH) / Float(res.height)
      camera["depth"] = [
        "width": dW, "height": dH,
        "fx": fx * sx, "fy": fy * sy,
        "cx": cx * sx, "cy": cy * sy,
      ]
    }

    // recording_fps is the effective post-decimation rate (what the mp4 / jsonl actually carry); camera.fps is the sensor rate.
    camera["recording_fps"] = fps / Double(max(1, recFrameStride))

    let cs = captureSettings
    let dict: [String: Any] = [
      "recording_config": "arkit",
      "device_model": currentDeviceModel(),
      "os_name": "iOS",
      "os_version": UIDevice.current.systemVersion,
      "app_version": "\(appVer) (\(appBuild))",
      "camera": camera,
      "capture_settings": [
        "resolution": cs.resolution,
        "auto_focus": cs.autoFocus,
        "recording_rate_hz": cs.recordingRate,
        "sync_rate": cs.syncRate,
        "depth_rate_hz": cs.depthRate,
        "point_cloud_rate_hz": cs.pointCloudRate,
        "imu_rate_hz": cs.imuRateHz,
        "streams": [
          "imu": cs.streamImu,
          "depth": cs.streamDepth,
          "point_cloud": cs.streamPointCloud,
          "mesh": cs.streamMesh,
        ],
        "frame_stride": recFrameStride,
      ],
      "calibration_baseline": NSNull(),
    ]

    do {
      let data = try JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted, .sortedKeys])
      try data.write(to: url, options: .atomic)
    } catch {
      NSLog("[ArkitCaptureController] metadata.json write failed: %@", "\(error)")
    }
  }

  /// Map ARCamera.TrackingState to an integer:
  ///   0 = notAvailable, 1 = limited, 2 = normal
  private func arkitTrackingStateInt(_ s: ARCamera.TrackingState) -> Int {
    switch s {
    case .notAvailable: return 0
    case .limited:      return 1
    case .normal:       return 2
    }
  }

  private func describeTrackingState(_ s: ARCamera.TrackingState) -> (state: String, reason: String) {
    switch s {
    case .notAvailable: return ("notAvailable", "")
    case .normal:       return ("normal", "")
    case .limited(let r):
      switch r {
      case .initializing:          return ("limited", "initializing")
      case .relocalizing:          return ("limited", "relocalizing")
      case .excessiveMotion:       return ("limited", "excessiveMotion")
      case .insufficientFeatures:  return ("limited", "insufficientFeatures")
      @unknown default:            return ("limited", "unknown")
      }
    @unknown default: return ("unknown", "")
    }
  }

  private func currentDeviceModel() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machineMirror = Mirror(reflecting: systemInfo.machine)
    let identifier = machineMirror.children.reduce("") { id, element in
      guard let value = element.value as? Int8, value != 0 else { return id }
      return id + String(UnicodeScalar(UInt8(value)))
    }
    return identifier
  }

  // MARK: - Snapshot

  func captureSnapshot(quality: CGFloat = 0.8) throws -> URL {
    latestBufferLock.lock()
    let buffer = latestPixelBuffer
    latestBufferLock.unlock()

    guard let pixelBuffer = buffer else {
      throw NSError(domain: "ArkitCaptureController", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "no frame available"])
    }
    let ci = CIImage(cvPixelBuffer: pixelBuffer).oriented(currentDisplayOrientation().cgImageOrientation)
    guard let cg = ciContext.createCGImage(ci, from: ci.extent) else {
      throw NSError(domain: "ArkitCaptureController", code: 11,
                    userInfo: [NSLocalizedDescriptionKey: "createCGImage failed"])
    }
    let ui = UIImage(cgImage: cg)
    guard let data = ui.jpegData(compressionQuality: quality) else {
      throw NSError(domain: "ArkitCaptureController", code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "jpegData failed"])
    }
    let dir = NSTemporaryDirectory()
    let ts = UInt64(Date().timeIntervalSince1970 * 1000)
    let url = URL(fileURLWithPath: "\(dir)arkit_snapshot_\(ts).jpg")
    try data.write(to: url)
    return url
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    let pixelBuffer = frame.capturedImage
    let timestamp = frame.timestamp
    let segmentationBuffer = frame.segmentationBuffer

    // Readiness gate: skip the initial convergence frames, then require a run of
    // consecutive .normal tracking frames. Ready latches true for the session.
    readinessFramesSeen += 1
    if !isSessionReady && readinessFramesSeen > Self.skipInitialFrames {
      if case .normal = frame.camera.trackingState {
        consecutiveNormalFrames += 1
        if consecutiveNormalFrames >= Self.minStableTrackingFrames {
          isSessionReady = true
          NSLog("[ArkitCaptureController] session ready (tracking stabilized)")
        }
      } else {
        consecutiveNormalFrames = 0
      }
    }

    latestBufferLock.lock()
    latestPixelBuffer = pixelBuffer
    latestBufferLock.unlock()

    // HandTracker (own queue, drop-while-busy).
    self.handTrackerSkipCount += 1
    if self.handTrackerSkipCount >= self.handTrackerInterval {
      self.handTrackerSkipCount = 0
      self.handTrackerBusyLock.lock()
      let shouldRunHandTracker = !self.handTrackerBusy
      if shouldRunHandTracker { self.handTrackerBusy = true }
      self.handTrackerBusyLock.unlock()

      if shouldRunHandTracker {
        let stampNs = arkitTimestampToNs(timestamp)
        let orientation = self.currentDisplayOrientation().cgImageOrientation
        self.handTrackerQueue.async { [weak self] in
          guard let self = self else { return }
          defer {
            self.handTrackerBusyLock.lock()
            self.handTrackerBusy = false
            self.handTrackerBusyLock.unlock()
          }
          let out = self.handTracker.process(pixelBuffer: pixelBuffer,
                                             segmentationBuffer: segmentationBuffer,
                                             orientation: orientation,
                                             timestamp: timestamp,
                                             timestampNs: stampNs)
          self.latestHandOutputLock.lock()
          self.latestHandOutput = out
          self.latestHandOutputLock.unlock()
          self.delegate?.arkitCapture(didTrackHand: out)
        }
      }
    }

    // Marker scan (drop-while-busy, single in-flight buffer, same rules as
    // HandTracker: the pooled buffer is held only by this one pending block).
    self.markerSkipCount += 1
    if self.markerSkipCount >= self.markerInterval {
      self.markerSkipCount = 0
      self.markerBusyLock.lock()
      let shouldScan = !self.markerBusy
      if shouldScan { self.markerBusy = true }
      self.markerBusyLock.unlock()

      if shouldScan {
        let orientation = self.currentDisplayOrientation().cgImageOrientation
        self.markerQueue.async { [weak self] in
          guard let self = self else { return }
          defer {
            self.markerBusyLock.lock()
            self.markerBusy = false
            self.markerBusyLock.unlock()
          }
          let request = VNDetectBarcodesRequest()
          request.symbologies = [.qr]
          let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer,
                                              orientation: orientation,
                                              options: [:])
          guard (try? handler.perform([request])) != nil else { return }
          for observation in request.results ?? [] {
            guard let payload = observation.payloadStringValue,
                  payload.hasPrefix("ROOTLENS") else { continue }
            self.delegate?.arkitCapture(didDetectMarker: payload)
            break
          }
        }
      }
    }

    // Recording (append the pixelBuffer to the AVAssetWriter and a row to
    // frames.jsonl). Only while recording.
    // ⚠ didUpdate runs on the main thread by default. Encoding moves to
    //    frameQueue, but capturedImage is one of ARKit's recycled buffers, so it
    //    is copied here and the copy is what gets appended asynchronously (see
    //    copyPixelBuffer).
    if !finishingWriter, let adaptor = self.pixelBufferAdaptor, let writer = self.assetWriter,
       let input = self.videoInput {
      // Per-ARFrame streams run at full sensor rate, before any sampling.
      appendPerFrameStreams(frame: frame, timestamp: timestamp)

      let tsNsForSampler = Int64(timestamp * 1_000_000_000.0)
      let tracking: Bool = {
        if case .normal = frame.camera.trackingState { return true }
        return false
      }()

      // Tracking-outage bookkeeping: depth / point cloud sampling stops during an
      // outage, and on recovery both slot grids shift past it (see FrameSampler).
      // RGB keeps recording through the outage - the video must stay continuous.
      if !tracking {
        if trackingPauseStartTs < 0 { trackingPauseStartTs = timestamp }
      } else if trackingPauseStartTs >= 0 {
        let pauseNs = Int64((timestamp - trackingPauseStartTs) * 1_000_000_000.0)
        depthSampler.recordTrackingPauseOffset(pauseNs)
        pcSampler.recordTrackingPauseOffset(pauseNs)
        trackingPauseCount += 1
        trackingPauseTotalNs += pauseNs
        trackingPauseStartTs = -1
      }

      // Deterministic slot grid: keep this frame only when it fills a new slot.
      guard rgbSampler.shouldEncodeFrame(timestampNs: tsNsForSampler) else { return }

      let settings = captureSettings
      let keepDepth = tracking && settings.streamDepth
        && depthSampler.shouldEncodeFrame(timestampNs: tsNsForSampler)
      let keepPc = tracking && settings.streamPointCloud
        && pcSampler.shouldEncodeFrame(timestampNs: tsNsForSampler)

      // Skip while the encoder cannot accept input or a stop is in progress (no buffer, no copy).
      if writer.status == .failed, !writerFailureLogged {
        writerFailureLogged = true
        let e = writer.error as NSError?
        let u = e?.userInfo[NSUnderlyingErrorKey] as? NSError
        NSLog("[ArkitCaptureController] ⚠ writer died mid-recording: av=%@ under=%@ frames=%d",
              e.map { "\($0.domain):\($0.code)" } ?? "nil",
              u.map { "\($0.domain):\($0.code)" } ?? "-",
              self.frameIndexCounter)
      }
      guard writer.status == .writing, input.isReadyForMoreMediaData else { return }

      // Copy into independent memory here (main thread), while ARKit's buffer is
      // still valid, and release it immediately. The PTS is also fixed here,
      // monotonically, so asynchrony cannot reorder frames.
      guard let copy = self.copyPixelBuffer(pixelBuffer) else { return }
      let pts = CMTimeMakeWithSeconds(timestamp, preferredTimescale: 1_000_000_000)
      if self.recordingStartTime == .invalid { self.recordingStartTime = pts }
      let adjPts = CMTimeSubtract(pts, self.recordingStartTime)

      // Snapshot everything the sensor row needs while the frame is valid. The
      // row is written only after the video append succeeds (below), so
      // frames.jsonl rows and mp4 frames stay strictly 1:1. A row
      // without its frame would silently shift every later RGB timestamp in the
      // delivered data, so a dropped frame must also drop its row.
      let rowData = self.makeFrameRowData(frame: frame, keepDepth: keepDepth, keepPc: keepPc)

      frameQueue.async { [weak self] in
        guard let self = self else { return }
        // No appends once stopping has begun (the authoritative gate; the flag is set on frameQueue, so ordering is guaranteed).
        guard !self.finishingWriter, writer.status == .writing, input.isReadyForMoreMediaData else { return }
        if adaptor.append(copy, withPresentationTime: adjPts) {
          self.writeSensorsLine(rowData)
        } else {
          self.appendFailCount += 1
          NSLog("[ArkitCaptureController] adaptor.append failed (#%d): status=%ld error=%@",
                self.appendFailCount, Int(writer.status.rawValue), Self.describeNSError(writer.error))
        }
      }
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    NSLog("[ArkitCaptureController] session failed: %@", "\(error)")
  }

  // MARK: - format pick

  /// Pick the video format for the requested resolution, preferring the 1x wide
  /// camera and the full-sensor 4:3 formats (widest field of view).
  /// Picks the capture format under a height cap: the largest sensor area whose
  /// height fits the cap, preferring the requested fps among equals, else the
  /// highest fps. "1440p" caps at 1440 and lands on the full-sensor 4:3 format
  /// (widest FoV); "1080p" / "720p" cap at their 16:9 crops.
  private func pickPreferredFormat(resolution: String, requestedFps: Int) -> ARConfiguration.VideoFormat? {
    let supported = ARWorldTrackingConfiguration.supportedVideoFormats

    if #available(iOS 16.0, *) {
      for (i, f) in supported.enumerated() {
        let kind = "\(f.captureDeviceType.rawValue)"
        NSLog("[ArkitCaptureController] supported format[%d]: %.0fx%.0f @ %.0f fps, device=%@",
              i, f.imageResolution.width, f.imageResolution.height, f.framesPerSecond, kind)
      }
    } else {
      for (i, f) in supported.enumerated() {
        NSLog("[ArkitCaptureController] supported format[%d]: %.0fx%.0f @ %.0f fps",
              i, f.imageResolution.width, f.imageResolution.height, f.framesPerSecond)
      }
    }

    let captureHeightLimit: CGFloat
    switch resolution {
    case "720p": captureHeightLimit = 720
    case "1080p": captureHeightLimit = 1080
    default: captureHeightLimit = 1440
    }

    if captureHeightLimit >= 2160, #available(iOS 16.0, *),
       let fourK = ARWorldTrackingConfiguration.recommendedVideoFormatFor4KResolution {
      return fourK
    }
    let withinCap = supported.filter { $0.imageResolution.height <= captureHeightLimit }
    if withinCap.isEmpty { return nil }
    let largestArea = withinCap.map { $0.imageResolution.width * $0.imageResolution.height }.max() ?? 0
    let largest = withinCap.filter { $0.imageResolution.width * $0.imageResolution.height == largestArea }
    if let match = largest.first(where: { Int($0.framesPerSecond) == requestedFps }) { return match }
    return largest.max(by: { $0.framesPerSecond < $1.framesPerSecond })
      ?? withinCap.max(by: {
        ($0.imageResolution.width * $0.imageResolution.height)
          < ($1.imageResolution.width * $1.imageResolution.height)
      })
  }
}
