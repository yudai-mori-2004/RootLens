import ARKit
import AVFoundation
import CoreImage
import CoreMotion
import CoreVideo
import Foundation
import ImageIO
import UIKit
import simd

// ARKit のセッションを 1 つだけ保持し、 2 つの責務を並走させる:
//
//   1. プレビュー (= ARSCNView に session を attach、 撮影開始前から動かす)
//   2. 録画 (= AVAssetWriter で ARFrame.capturedImage を H.264 MP4 に書き出す)
//
// さらに、 全 ARFrame に対して HandTracker を 15 fps で走らせて、 装着者の手の状態を
// React Native 側にイベントとして emit する。 これは録画中・録画前関係なく動く。
// 端末側では永続化しない (= サーバが MP4 から再抽出する、 SPECS §2.4)。
//
// SPECS_JA §2.10 段階 1: 端末は MP4 を吐くだけ。 C2PA 署名 (= 「署名 S」) はサーバ受領後に
// サーバ証明書で付与する。 段階 2 で端末 TEE 署名 (= 「署名 D」) を追加するが MVP では未実装。

protocol ArkitCaptureControllerDelegate: AnyObject {
  func arkitCapture(didTrackHand output: HandTracker.Output)
}

/// 表示 orientation。 RN 側の ScreenOrientation listener から動的に渡される。
/// HandTracker / snapshot / 録画 MP4 の transform に使う。
enum DisplayOrientation {
  case portrait        // UIInterfaceOrientation.portrait
  case landscapeLeft   // home/usb-c が左、 sensor 比 180° 回転
  case landscapeRight  // home/usb-c が右、 sensor と同じ向き

  var cgImageOrientation: CGImagePropertyOrientation {
    switch self {
    case .portrait:       return .right   // 90° CW: sensor landscape → display portrait
    case .landscapeRight: return .up      // identity
    case .landscapeLeft:  return .down    // 180°
    }
  }

  /// AVAssetWriterInput.transform に渡す行列。 byte 列を sensor のまま保持し、
  /// プレイヤーに「再生時に回転して」 と伝える (= per-frame の CI render を避けて省電力)。
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

  // 表示 orientation
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

  // 直近 pixelBuffer (= captureSnapshot 用)
  private var latestPixelBuffer: CVPixelBuffer?
  private var latestImageSize: CGSize = .zero
  private let latestBufferLock = NSLock()

  // HandTracker は別 queue + 「処理中なら drop」 pattern (= backlog 防止)
  private let handTrackerQueue = DispatchQueue(label: "io.rootlens.arkit-capture.handtracker", qos: .userInitiated)
  private let handTrackerBusyLock = NSLock()
  private var handTrackerBusy = false
  private var handTrackerSkipCount: Int = 0
  private let handTrackerInterval: Int = 4  // ARKit 60Hz / 4 ≈ 15 Hz

  // 録画 state (recording 中のみ非 nil)
  private var assetWriter: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var pixelBufferAdaptor: AVAssetWriterInputPixelBufferAdaptor?
  private var recordingStartTime: CMTime = .invalid
  private var sessionDirURL: URL?
  private var rgbMp4URL: URL?

  // sensor stream state (= recording 中のみ非 nil、 Pipeline 1 出力ファイル群を逐次 append)
  private var sensorsFileHandle: FileHandle?
  private var imuFileHandle: FileHandle?
  private var frameIndexCounter: Int = 0
  private let sensorFileQueue = DispatchQueue(label: "io.rootlens.arkit-capture.sensors", qos: .utility)
  private let motionManager = CMMotionManager()
  private let motionQueue = OperationQueue()

  // セッション稼働状態
  private var sessionRunning = false

  private override init() {
    super.init()
    session.delegate = self
  }

  // MARK: - Preview attach

  var arSession: ARSession { session }

  /// 現在 ARKit が使用している videoFormat の sensor 解像度。 PreviewView の aspect-fill で使う。
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
    let config = ARWorldTrackingConfiguration()
    config.worldAlignment = .gravity
    config.providesAudioData = false
    if ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics.insert(.sceneDepth)
    }
    if ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
    }
    let chosen = pickPreferredFormat()
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
    session.run(config, options: [.resetTracking, .removeExistingAnchors])
    sessionRunning = true
  }

  func stopSession() {
    if !sessionRunning { return }
    session.pause()
    sessionRunning = false
  }

  // MARK: - Recording lifecycle (Pipeline 1 全 sensor 出力)

  /// 1 セッション分のキャプチャを開始する。 引数 sessionDir 配下に以下を並走出力する:
  ///   rgb.mp4               H.264 AVAssetWriter 出力 (= ARFrame.capturedImage)
  ///   sensors.jsonl         per-frame の camera transform / intrinsics / tracking / IMU 軽量 sample
  ///   imu_high_rate.jsonl   CMMotionManager 100 Hz サンプル
  ///   camera_intrinsics.json デバイス + 解像度 + intrinsics の 1 回書き出し
  /// stopRecording で全 handle を flush + close + return。
  func startRecording(sessionDir: URL) throws -> URL {
    if assetWriter != nil {
      throw NSError(domain: "ArkitCaptureController", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "already recording"])
    }

    try FileManager.default.createDirectory(at: sessionDir, withIntermediateDirectories: true)

    // sensor 解像度を取得して AVAssetWriter を構成
    let sensorRes = currentSensorResolution()
    let sensorW = Int(sensorRes.width)
    let sensorH = Int(sensorRes.height)
    if sensorW == 0 || sensorH == 0 {
      throw NSError(domain: "ArkitCaptureController", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "sensor resolution unknown"])
    }

    let mp4URL = sessionDir.appendingPathComponent("rgb.mp4")
    try? FileManager.default.removeItem(at: mp4URL)

    let writer = try AVAssetWriter(outputURL: mp4URL, fileType: .mp4)
    // 6 Mbps target (= 60fps 1080p で十分な品質、 5 分動画で ~225 MB)。
    // サーバ側で再 encode するので深く詰めない。
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: sensorW,
      AVVideoHeightKey: sensorH,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 6_000_000,
        AVVideoMaxKeyFrameIntervalKey: 60,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
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

    // sensor stream の出力 file を準備
    let sensorsURL = sessionDir.appendingPathComponent("sensors.jsonl")
    let imuURL = sessionDir.appendingPathComponent("imu_high_rate.jsonl")
    try? FileManager.default.removeItem(at: sensorsURL)
    try? FileManager.default.removeItem(at: imuURL)
    FileManager.default.createFile(atPath: sensorsURL.path, contents: nil)
    FileManager.default.createFile(atPath: imuURL.path, contents: nil)
    let sensorsHandle = try FileHandle(forWritingTo: sensorsURL)
    let imuHandle = try FileHandle(forWritingTo: imuURL)

    // depth ディレクトリ (= Pro 機の sceneDepth は LiDAR、 非 Pro 機では空のまま)
    let depthDir = sessionDir.appendingPathComponent("depth")
    try? FileManager.default.removeItem(at: depthDir)
    try FileManager.default.createDirectory(at: depthDir, withIntermediateDirectories: true)

    // camera_intrinsics.json は intrinsics 確定するまで待ちたいので、 初回 frame で書く
    // (= ARFrame の camera.intrinsics は最初の didUpdate まで埋まらない可能性)

    self.assetWriter = writer
    self.videoInput = input
    self.pixelBufferAdaptor = adaptor
    self.recordingStartTime = .invalid
    self.sessionDirURL = sessionDir
    self.rgbMp4URL = mp4URL
    self.sensorsFileHandle = sensorsHandle
    self.imuFileHandle = imuHandle
    self.frameIndexCounter = 0

    if !sessionRunning { startSession() }
    handTracker.setRecordingMode(true)
    startMotionUpdates()

    return sessionDir
  }

  /// 1 セッションを終了。 全ファイルを flush + close する。 返値は sessionDir URL。
  func stopRecording() throws -> URL {
    guard let writer = assetWriter, let input = videoInput, let dir = sessionDirURL else {
      throw NSError(domain: "ArkitCaptureController", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "not recording"])
    }
    handTracker.setRecordingMode(false)
    stopMotionUpdates()

    input.markAsFinished()
    let group = DispatchGroup()
    group.enter()
    writer.finishWriting {
      group.leave()
    }
    group.wait()

    // sensor file は sensorFileQueue 上で書いてるので、 そこでの flush を待ってから close する
    sensorFileQueue.sync {
      try? self.sensorsFileHandle?.synchronize()
      try? self.sensorsFileHandle?.close()
      try? self.imuFileHandle?.synchronize()
      try? self.imuFileHandle?.close()
    }

    self.assetWriter = nil
    self.videoInput = nil
    self.pixelBufferAdaptor = nil
    self.recordingStartTime = .invalid
    self.sessionDirURL = nil
    self.rgbMp4URL = nil
    self.sensorsFileHandle = nil
    self.imuFileHandle = nil
    self.frameIndexCounter = 0

    if writer.status == .failed {
      throw writer.error ?? NSError(domain: "ArkitCaptureController", code: 5,
                                    userInfo: [NSLocalizedDescriptionKey: "writer failed"])
    }
    return dir
  }

  // MARK: - sensor JSONL writers

  /// CMMotionManager を 100 Hz で起動、 imu_high_rate.jsonl に append。
  private func startMotionUpdates() {
    guard motionManager.isDeviceMotionAvailable else {
      NSLog("[ArkitCaptureController] CMDeviceMotion unavailable, skipping imu_high_rate")
      return
    }
    motionManager.deviceMotionUpdateInterval = 1.0 / 100.0
    motionQueue.maxConcurrentOperationCount = 1
    motionManager.startDeviceMotionUpdates(to: motionQueue) { [weak self] motion, _ in
      guard let self = self, let m = motion else { return }
      self.appendImuLine(motion: m)
    }
  }

  private func stopMotionUpdates() {
    if motionManager.isDeviceMotionActive {
      motionManager.stopDeviceMotionUpdates()
    }
  }

  /// 1 frame ぶんの sensors.jsonl 行を書き出す (= sensorFileQueue 上)。
  /// camera_intrinsics.json が未書きならここで 1 回だけ書く (= 初回 frame で intrinsics が確定する)。
  private func writeSensorsLine(frame: ARFrame) {
    guard let handle = sensorsFileHandle else { return }
    let frameIndex = frameIndexCounter
    frameIndexCounter += 1

    let ts = frame.timestamp
    let t = frame.camera.transform        // simd_float4x4 (= column-major)
    let k = frame.camera.intrinsics       // simd_float3x3
    let trackingPair = describeTrackingState(frame.camera.trackingState)

    // row-major 4×4 → [[Float; 4]; 4]
    let row0 = [t.columns.0[0], t.columns.1[0], t.columns.2[0], t.columns.3[0]]
    let row1 = [t.columns.0[1], t.columns.1[1], t.columns.2[1], t.columns.3[1]]
    let row2 = [t.columns.0[2], t.columns.1[2], t.columns.2[2], t.columns.3[2]]
    let row3 = [t.columns.0[3], t.columns.1[3], t.columns.2[3], t.columns.3[3]]
    let transformRows: [[Float]] = [row0, row1, row2, row3]

    // row-major 3×3 を 9 要素 flat に
    let intr: [Float] = [
      k.columns.0[0], k.columns.1[0], k.columns.2[0],
      k.columns.0[1], k.columns.1[1], k.columns.2[1],
      k.columns.0[2], k.columns.1[2], k.columns.2[2],
    ]

    // IMU snapshot (= 直近 CMDeviceMotion)
    let mot = motionManager.deviceMotion
    let imuDict: [String: Any]
    if let m = mot {
      imuDict = [
        "orientation": [m.attitude.quaternion.x, m.attitude.quaternion.y, m.attitude.quaternion.z, m.attitude.quaternion.w],
        "angular_velocity": [m.rotationRate.x, m.rotationRate.y, m.rotationRate.z],
        "linear_acceleration": [
          m.userAcceleration.x + m.gravity.x,
          m.userAcceleration.y + m.gravity.y,
          m.userAcceleration.z + m.gravity.z,
        ],
      ]
    } else {
      imuDict = [:]
    }

    let line: [String: Any] = [
      "ts": ts,
      "frame_index": frameIndex,
      "tracking_state": trackingPair.state,
      "tracking_reason": trackingPair.reason,
      "camera_transform": transformRows,
      "camera_intrinsics": intr,
      "imu": imuDict,
    ]

    sensorFileQueue.async {
      do {
        let data = try JSONSerialization.data(withJSONObject: line, options: [])
        handle.write(data)
        handle.write(Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] sensors.jsonl write failed: %@", "\(error)")
      }
    }

    // 初回 frame で camera_intrinsics.json を 1 回書く
    if frameIndex == 0, let dir = sessionDirURL {
      writeCameraIntrinsicsJson(into: dir, frame: frame)
    }

    // LiDAR depth を depth/<frameIndex:06>.png に書き出す (= sceneDepth がある場合のみ)
    if let sceneDepth = frame.sceneDepth, let dir = sessionDirURL {
      let depthDir = dir.appendingPathComponent("depth")
      let depthURL = depthDir.appendingPathComponent(String(format: "%06d.png", frameIndex))
      // pixelBuffer は CVPixelBuffer の参照、 retain して queue に流す
      let buffer = sceneDepth.depthMap
      sensorFileQueue.async {
        self.writeDepthPng(depthMap: buffer, to: depthURL)
      }
    }
  }

  /// CVPixelBuffer (= ARKit sceneDepth、 kCVPixelFormatType_DepthFloat32) を
  /// 16-bit gray PNG として書き出す。 値は float32 m → uint16 mm に量子化。
  private func writeDepthPng(depthMap: CVPixelBuffer, to url: URL) {
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

    let width = CVPixelBufferGetWidth(depthMap)
    let height = CVPixelBufferGetHeight(depthMap)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
    guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return }

    let floatStride = bytesPerRow / MemoryLayout<Float32>.size
    let floatPtr = base.assumingMemoryBound(to: Float32.self)

    // float32 (= m) → uint16 (= mm)
    var u16 = [UInt16](repeating: 0, count: width * height)
    for y in 0..<height {
      let srcRow = y * floatStride
      let dstRow = y * width
      for x in 0..<width {
        let m = floatPtr[srcRow + x]
        let mm = m.isNaN ? 0 : m * 1000.0
        let clamped = max(0.0, min(65535.0, Double(mm)))
        u16[dstRow + x] = UInt16(clamped)
      }
    }

    // CGImage 16-bit gray を組み立て、 ImageIO で PNG として書く
    let cs = CGColorSpaceCreateDeviceGray()
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue | CGBitmapInfo.byteOrder16Little.rawValue)
    let data = NSData(bytes: u16, length: u16.count * 2)
    guard let provider = CGDataProvider(data: data as CFData) else { return }
    guard let cgImage = CGImage(
      width: width, height: height,
      bitsPerComponent: 16, bitsPerPixel: 16,
      bytesPerRow: width * 2,
      space: cs, bitmapInfo: bitmapInfo,
      provider: provider,
      decode: nil, shouldInterpolate: false,
      intent: .defaultIntent
    ) else { return }

    guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(dest, cgImage, nil)
    CGImageDestinationFinalize(dest)
  }

  private func appendImuLine(motion: CMDeviceMotion) {
    guard let handle = imuFileHandle else { return }
    let line: [String: Any] = [
      "ts": motion.timestamp,
      "orientation": [motion.attitude.quaternion.x, motion.attitude.quaternion.y, motion.attitude.quaternion.z, motion.attitude.quaternion.w],
      "angular_velocity": [motion.rotationRate.x, motion.rotationRate.y, motion.rotationRate.z],
      "linear_acceleration": [
        motion.userAcceleration.x + motion.gravity.x,
        motion.userAcceleration.y + motion.gravity.y,
        motion.userAcceleration.z + motion.gravity.z,
      ],
    ]
    sensorFileQueue.async {
      do {
        let data = try JSONSerialization.data(withJSONObject: line, options: [])
        handle.write(data)
        handle.write(Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] imu_high_rate.jsonl write failed: %@", "\(error)")
      }
    }
  }

  private func writeCameraIntrinsicsJson(into dir: URL, frame: ARFrame) {
    let url = dir.appendingPathComponent("camera_intrinsics.json")
    let k = frame.camera.intrinsics
    let res = frame.camera.imageResolution
    let fps: Double = {
      if let cfg = session.configuration as? ARWorldTrackingConfiguration {
        return Double(cfg.videoFormat.framesPerSecond)
      }
      return 30.0
    }()

    var dict: [String: Any] = [
      "device_model": currentDeviceModel(),
      "platform": "iOS",
      "os_version": UIDevice.current.systemVersion,
      "rgb": [
        "width": Int(res.width),
        "height": Int(res.height),
        "fps": fps,
        "fx": k.columns.0[0],
        "fy": k.columns.1[1],
        "cx": k.columns.2[0],
        "cy": k.columns.2[1],
      ],
    ]
    // LiDAR 機なら depth 解像度 + intrinsics も書く (= ARFrame.sceneDepth が存在する場合)
    if let depth = frame.sceneDepth {
      let dW = CVPixelBufferGetWidth(depth.depthMap)
      let dH = CVPixelBufferGetHeight(depth.depthMap)
      // depth intrinsics は ARKit が直接 expose しない: RGB intrinsics に解像度比で
      // スケーリングするのが Project Aria / Stera の慣行。
      let sx = Float(dW) / Float(res.width)
      let sy = Float(dH) / Float(res.height)
      dict["depth"] = [
        "width": dW,
        "height": dH,
        "fx": k.columns.0[0] * sx,
        "fy": k.columns.1[1] * sy,
        "cx": k.columns.2[0] * sx,
        "cy": k.columns.2[1] * sy,
      ]
    }

    do {
      let data = try JSONSerialization.data(withJSONObject: dict, options: [.prettyPrinted])
      try data.write(to: url, options: .atomic)
    } catch {
      NSLog("[ArkitCaptureController] camera_intrinsics.json write failed: %@", "\(error)")
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

  // MARK: - Snapshot (VLM 用)

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
    let imageRes = frame.camera.imageResolution
    let segmentationBuffer = frame.segmentationBuffer

    latestBufferLock.lock()
    latestPixelBuffer = pixelBuffer
    latestImageSize = imageRes
    latestBufferLock.unlock()

    // HandTracker (= 別 queue + drop pattern)
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
          self.delegate?.arkitCapture(didTrackHand: out)
        }
      }
    }

    // 録画 (= AVAssetWriter に pixelBuffer を append + sensors.jsonl 行 append)。 録画中のみ。
    if let adaptor = self.pixelBufferAdaptor, let writer = self.assetWriter {
      // sensors.jsonl は全 ARFrame に 1 行ずつ。 RGB frame と frame_index を揃える
      // (= 録画中に append される rgb frame と 1:1 で対応)
      self.writeSensorsLine(frame: frame)

      frameQueue.async { [weak self] in
        guard let self = self else { return }
        guard writer.status == .writing else { return }
        guard let inp = self.videoInput, inp.isReadyForMoreMediaData else { return }

        let pts = CMTimeMakeWithSeconds(timestamp, preferredTimescale: 1_000_000_000)
        // session の base time を最初の frame に合わせる (= MP4 の time origin を 0 にしない)
        if self.recordingStartTime == .invalid {
          self.recordingStartTime = pts
        }
        let adjPts = CMTimeSubtract(pts, self.recordingStartTime)
        if !adaptor.append(pixelBuffer, withPresentationTime: adjPts) {
          NSLog("[ArkitCaptureController] adaptor.append failed: status=%ld error=%@",
                Int(writer.status.rawValue), "\(writer.error?.localizedDescription ?? "nil")")
        }
      }
    }
  }

  func session(_ session: ARSession, didFailWithError error: Error) {
    NSLog("[ArkitCaptureController] session failed: %@", "\(error)")
  }

  // MARK: - format pick

  /// 選択優先順:
  ///   1. 広角 (= builtInUltraWideCamera) かつ 720 系
  ///   2. 広角 + 任意の解像度
  ///   3. 通常広角 + 720 系
  ///   4. ARKit の default
  private func pickPreferredFormat() -> ARConfiguration.VideoFormat? {
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

    if #available(iOS 16.0, *) {
      let ultras = supported.filter { $0.captureDeviceType == .builtInUltraWideCamera }
      if let smallUltra = ultras.min(by: { abs($0.imageResolution.height - 720) < abs($1.imageResolution.height - 720) }),
         abs(smallUltra.imageResolution.height - 720) <= 240 {
        return smallUltra
      }
      if let anyUltra = ultras.first { return anyUltra }

      let normals = supported.filter { $0.captureDeviceType == .builtInWideAngleCamera }
      if let smallNormal = normals.min(by: { abs($0.imageResolution.height - 720) < abs($1.imageResolution.height - 720) }),
         abs(smallNormal.imageResolution.height - 720) <= 240 {
        return smallNormal
      }
    }
    return supported.first
  }
}
