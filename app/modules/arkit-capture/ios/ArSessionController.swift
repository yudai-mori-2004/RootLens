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

  // 直近の HandTracker 出力 (= realtime_handpose.jsonl の per-frame 行に hands を埋めるため保持)。
  // HandTracker は ~15Hz、 行書き出しは ARFrame 全数 (~60Hz) なので、 連続行は直近の hands を共有する。
  private var latestHandOutput: HandTracker.Output?
  private let latestHandOutputLock = NSLock()

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
  // LiDAR depth (= sceneDepth) を 16-bit PNG (mm) として 1 本の depth.tar に streaming 追記する。
  // 初回 depth frame で lazy 生成 (= 非 LiDAR 機では nil のまま = depth.tar を作らない)。
  private var depthTarHandle: FileHandle?
  private var frameIndexCounter: Int = 0
  private let sensorFileQueue = DispatchQueue(label: "io.rootlens.arkit-capture.sensors", qos: .utility)
  private let motionManager = CMMotionManager()
  private let motionQueue = OperationQueue()

  // MARK: - Capture settings (= JS 側の撮影設定。 次の startSession / startRecording から適用)

  struct CaptureSettings {
    var resolution = "1440p"        // "1440p" (4:3 最大画角) | "1080p" | "720p"
    var autoFocus = true
    var recordingRate = 30          // RGB / depth / point cloud の書き出し Hz (15/30/60)
    var syncRate = true             // false なら depthRate / pointCloudRate を個別適用 (≤ recordingRate)
    var depthRate = 30
    var pointCloudRate = 30
    var imuRateHz = 100             // 50 / 100 / 200
    var streamImu = true
    var streamDepth = true
    var streamPointCloud = true
    var streamMesh = true
  }

  private(set) var captureSettings = CaptureSettings()

  /// JS からの撮影設定 (JSON)。 次の startSession / startRecording から適用される。
  func applyCaptureSettings(json: String) {
    guard let data = json.data(using: .utf8),
          let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      NSLog("[ArkitCaptureController] applyCaptureSettings: invalid json")
      return
    }
    var s = CaptureSettings()
    if let v = obj["resolution"] as? String { s.resolution = v }
    if let v = obj["autoFocus"] as? Bool { s.autoFocus = v }
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

  // 書き出しの間引き (= 録画開始時に videoFormat fps と設定から確定)
  private var recFrameStride = 1        // ARFrame N 枚に 1 枚書く (= mp4 + jsonl)
  private var depthEveryWritten = 1     // 書いた frame M 枚に 1 枚 depth
  private var pcEveryWritten = 1        // 書いた frame M 枚に 1 枚 point cloud
  private var recArFrameCounter = 0
  private var pointCloudFileHandle: FileHandle?

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
    config.isAutoFocusEnabled = captureSettings.autoFocus
    if captureSettings.streamDepth, ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth) {
      config.frameSemantics.insert(.sceneDepth)
    }
    if captureSettings.streamMesh, ARWorldTrackingConfiguration.supportsSceneReconstruction(.mesh) {
      config.sceneReconstruction = .mesh
    }
    let chosen = pickPreferredFormat(resolution: captureSettings.resolution)
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
    // 構成切替 (arkit → ultra_wide) で AVCaptureSession が同じ ultra-wide カメラを掴む前に、
    // ARKit frame の IOSurface を宙に浮かせないよう、 in-flight の HandTracker (= Vision/ANE) を
    // drain し、 保持中の pixel buffer / hand output を解放する (= wide-capture 側と対称)。
    handTrackerQueue.sync {}
    latestBufferLock.lock()
    latestPixelBuffer = nil
    latestBufferLock.unlock()
    latestHandOutputLock.lock()
    latestHandOutput = nil
    latestHandOutputLock.unlock()
  }

  // MARK: - Recording lifecycle (Pipeline 1 全 sensor 出力)

  /// 1 セッション分のキャプチャを開始する。 引数 sessionDir 配下に以下を並走出力する:
  ///   rgb.mp4               H.264 AVAssetWriter 出力 (= ARFrame.capturedImage)
  ///   realtime_handpose.jsonl         per-frame の camera transform / intrinsics / tracking / IMU 軽量 sample
  ///   imu.jsonl   CMMotionManager 100 Hz サンプル
  ///   metadata.json デバイス + 解像度 + intrinsics の 1 回書き出し
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
    try removeIfExists(at: mp4URL)

    let writer = try AVAssetWriter(outputURL: mp4URL, fileType: .mp4)
    // 12 Mbps target (= 1920x1440 フルセンサー録画に合わせて増額。 5 分動画で ~450 MB)。
    // サーバ側で再 encode するので深く詰めない。
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: sensorW,
      AVVideoHeightKey: sensorH,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 12_000_000,
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

    // sensor stream の出力 file を準備 (= IMU / point cloud は設定 ON のときだけ作る)
    let sensorsURL = sessionDir.appendingPathComponent("realtime_handpose.jsonl")
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

    // depth は録画中に depth.tar へ streaming 追記する (= 初回 depth frame で lazy 生成)。
    // ここでは旧 depth/ dir を念のため除去するだけ。
    try removeIfExists(at: sessionDir.appendingPathComponent("depth.tar"))
    try removeIfExists(at: sessionDir.appendingPathComponent("depth"))

    // 書き出しレートの間引き幅を確定 (= session fps と設定から)。
    let sessionFps: Double = {
      if let cfg = session.configuration as? ARWorldTrackingConfiguration {
        return Double(cfg.videoFormat.framesPerSecond)
      }
      return 30.0
    }()
    recFrameStride = max(1, Int((sessionFps / Double(max(1, captureSettings.recordingRate))).rounded()))
    let effectiveRate = sessionFps / Double(recFrameStride)
    let dRate = captureSettings.syncRate ? captureSettings.recordingRate
      : min(captureSettings.depthRate, captureSettings.recordingRate)
    let pRate = captureSettings.syncRate ? captureSettings.recordingRate
      : min(captureSettings.pointCloudRate, captureSettings.recordingRate)
    depthEveryWritten = max(1, Int((effectiveRate / Double(max(1, dRate))).rounded()))
    pcEveryWritten = max(1, Int((effectiveRate / Double(max(1, pRate))).rounded()))
    recArFrameCounter = 0

    // metadata.json は intrinsics 確定するまで待ちたいので、 初回 frame で書く
    // (= ARFrame の camera.intrinsics は最初の didUpdate まで埋まらない可能性)

    self.assetWriter = writer
    self.videoInput = input
    self.pixelBufferAdaptor = adaptor
    self.recordingStartTime = .invalid
    self.sessionDirURL = sessionDir
    self.rgbMp4URL = mp4URL
    self.sensorsFileHandle = sensorsHandle
    self.imuFileHandle = imuHandle
    self.pointCloudFileHandle = pcHandle
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

    // sensor file は sensorFileQueue 上で書いてるので、 そこでの flush を待ってから close する。
    // sync を欠かすと データが途中で切れる (= 不正データ) ので、 失敗時は必ず throw して呼び出し元に伝える。
    var sensorCloseError: Error?
    sensorFileQueue.sync {
      do {
        self.finalizeDepthTar()  // depth.tar の終端 (= 2×512 zero blocks) を書いて close (= depth が無ければ no-op)
        try self.sensorsFileHandle?.synchronize()
        try self.sensorsFileHandle?.close()
        try self.imuFileHandle?.synchronize()
        try self.imuFileHandle?.close()
        try self.pointCloudFileHandle?.synchronize()
        try self.pointCloudFileHandle?.close()
      } catch {
        sensorCloseError = error
      }
    }

    // シーンメッシュ (= ARMeshAnchor) を mesh.jsonl に書き出す (= 設定 ON かつ LiDAR 機のみ)。
    if captureSettings.streamMesh {
      writeMeshJsonl(into: dir)
    }

    self.assetWriter = nil
    self.videoInput = nil
    self.pixelBufferAdaptor = nil
    self.recordingStartTime = .invalid
    self.sessionDirURL = nil
    self.rgbMp4URL = nil
    self.sensorsFileHandle = nil
    self.imuFileHandle = nil
    self.pointCloudFileHandle = nil
    self.depthTarHandle = nil
    self.frameIndexCounter = 0

    if writer.status == .failed {
      throw writer.error ?? NSError(domain: "ArkitCaptureController", code: 5,
                                    userInfo: [NSLocalizedDescriptionKey: "writer failed"])
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

  /// 存在しなければ no-op、 存在すれば throw 込みで削除する。 try? の代わりに使う。
  private func removeIfExists(at url: URL) throws {
    if FileManager.default.fileExists(atPath: url.path) {
      try FileManager.default.removeItem(at: url)
    }
  }

  // MARK: - sensor JSONL writers

  /// CMMotionManager を 100 Hz で起動、 imu.jsonl に append。
  private func startMotionUpdates() {
    guard motionManager.isDeviceMotionAvailable else {
      NSLog("[ArkitCaptureController] CMDeviceMotion unavailable, skipping imu_high_rate")
      return
    }
    motionManager.deviceMotionUpdateInterval = 1.0 / Double(max(1, captureSettings.imuRateHz))
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

  /// 直近 HandTracker 出力から hands 配列を作る (= wide-capture の makeFrameRow と同形)。
  /// `[{handedness, confidence, landmarks:[{x,y,confidence}×21]}]`。 検出無しなら空配列。
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

  /// 1 frame ぶんの realtime_handpose.jsonl 行を書き出す (= sensorFileQueue 上)。
  /// metadata.json が未書きならここで 1 回だけ書く (= 初回 frame で intrinsics が確定する)。
  private func writeSensorsLine(frame: ARFrame) {
    guard let handle = sensorsFileHandle else { return }
    let frameIndex = frameIndexCounter
    frameIndexCounter += 1

    let ts = frame.timestamp
    let t = frame.camera.transform        // simd_float4x4 (= column-major)
    let k = frame.camera.intrinsics       // simd_float3x3
    let trackingPair = describeTrackingState(frame.camera.trackingState)
    // 正規スキーマ (= tools/gen-dummy-sensors.py + tools/modal/gtsam_eval.py が期待):
    //   timestamp_ns: int (= ts 秒 × 1e9)
    //   tracking_state: int (= ARKit enum 値、 normal=2)
    let tsNs: Int64 = Int64(ts * 1_000_000_000.0)
    let trackingStateInt = arkitTrackingStateInt(frame.camera.trackingState)

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

    // IMU snapshot (= 直近 CMDeviceMotion)。 schema は imu.jsonl と揃える:
    //   accel = userAccel + gravity, gyro = rotationRate, mag は zero placeholder
    let mot = motionManager.deviceMotion
    let imuDict: [String: Any]
    if let m = mot {
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

    let line: [String: Any] = [
      "frame_index": frameIndex,
      "timestamp_ns": tsNs,
      "tracking_state": trackingStateInt,
      "tracking_reason": trackingPair.reason,
      "camera_transform": transformRows,
      "camera_intrinsics": intr,
      "imu": imuDict,
      "hands": buildHandsArray(),  // 直近 HandTracker 出力 (= ultra_wide と同形)
    ]

    sensorFileQueue.async {
      do {
        let data = try JSONSerialization.data(withJSONObject: line, options: [])
        // NSFileHandle.write(_:) は EAGAIN 等で ObjC 例外 (NSFileHandleOperationException)
        // を投げ、 Swift do/try/catch では捕まらず即クラッシュする。 iOS 13.4+ の
        // throwing 版 write(contentsOf:) を使うと Swift error として catch できる。
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] realtime_handpose.jsonl write failed: %@", "\(error)")
      }
    }

    // 初回 frame で metadata.json を 1 回書く
    if frameIndex == 0, let dir = sessionDirURL {
      writeMetadataJson(into: dir, frame: frame)
    }

    // LiDAR depth (= sceneDepth がある Pro 機のみ)。 標準形式の 16-bit PNG (mm) を
    // depth.tar に streaming 追記する (= 数万 loose PNG を避け 1 ファイルで upload。 中身は標準 PNG)。
    // tar 内パスは depth/<frameIndex:06>.png (= 展開すれば RGB-D 標準の depth/ レイアウト)。
    // depth レートが RGB より低い設定では書いた frame ベースで間引く (= index は jsonl と共有)。
    if let sceneDepth = frame.sceneDepth, sessionDirURL != nil, frameIndex % depthEveryWritten == 0 {
      let buffer = sceneDepth.depthMap
      let idx = frameIndex
      sensorFileQueue.async {
        self.appendDepthFrameToTar(depthMap: buffer, frameIndex: idx)
      }
    }

    // 特徴点群 (= ARKit VIO の rawFeaturePoints)。 xyz は float32 LE、 id は uint64 LE を base64 で
    // 1 frame 1 行 (= pointcloud.jsonl)。 world 座標なので蓄積すれば map になる。
    if let pcHandle = pointCloudFileHandle,
       frameIndex % pcEveryWritten == 0,
       let cloud = frame.rawFeaturePoints,
       !cloud.points.isEmpty {
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
        "timestamp_ns": tsNs,
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

  /// CVPixelBuffer (= ARKit sceneDepth、 kCVPixelFormatType_DepthFloat32) を
  /// 16-bit gray PNG (= float32 m → uint16 mm) の Data にして返す。 RGB-D データセット標準形式。
  private func depthMapToPngData(_ depthMap: CVPixelBuffer) -> Data? {
    CVPixelBufferLockBaseAddress(depthMap, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(depthMap, .readOnly) }

    let width = CVPixelBufferGetWidth(depthMap)
    let height = CVPixelBufferGetHeight(depthMap)
    let bytesPerRow = CVPixelBufferGetBytesPerRow(depthMap)
    guard let base = CVPixelBufferGetBaseAddress(depthMap) else { return nil }

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

    let cs = CGColorSpaceCreateDeviceGray()
    let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue | CGBitmapInfo.byteOrder16Little.rawValue)
    let data = NSData(bytes: u16, length: u16.count * 2)
    guard let provider = CGDataProvider(data: data as CFData) else { return nil }
    guard let cgImage = CGImage(
      width: width, height: height,
      bitsPerComponent: 16, bitsPerPixel: 16,
      bytesPerRow: width * 2,
      space: cs, bitmapInfo: bitmapInfo,
      provider: provider,
      decode: nil, shouldInterpolate: false,
      intent: .defaultIntent
    ) else { return nil }

    let out = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(out as CFMutableData, "public.png" as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, cgImage, nil)
    guard CGImageDestinationFinalize(dest) else { return nil }
    return out as Data
  }

  // MARK: - depth.tar streaming writer (= ustar tar、 中身は 16-bit PNG)

  /// 1 depth frame を 16-bit PNG 化して depth.tar に 1 entry として追記する (= sensorFileQueue 上)。
  /// 初回呼び出しで depth.tar を lazy 生成する (= depth が来ない非 LiDAR 機では作られない)。
  private func appendDepthFrameToTar(depthMap: CVPixelBuffer, frameIndex: Int) {
    guard let png = depthMapToPngData(depthMap) else { return }
    if depthTarHandle == nil {
      guard let dir = sessionDirURL else { return }
      let url = dir.appendingPathComponent("depth.tar")
      FileManager.default.createFile(atPath: url.path, contents: nil)
      depthTarHandle = try? FileHandle(forWritingTo: url)
    }
    guard let h = depthTarHandle else { return }
    let name = String(format: "depth/%06d.png", frameIndex)
    do {
      try h.write(contentsOf: Self.tarHeader(name: name, size: png.count))
      try h.write(contentsOf: png)
      let pad = (512 - (png.count % 512)) % 512
      if pad > 0 { try h.write(contentsOf: Data(count: pad)) }
    } catch {
      NSLog("[ArkitCaptureController] depth.tar write failed: %@", "\(error)")
    }
  }

  /// tar の終端 (= 2×512 byte の zero block) を書いて close する。 depth が無ければ no-op。
  /// ARKit のシーン再構成メッシュ (ARMeshAnchor) を 1 anchor = 1 行の JSONL で書き出す。
  /// vertices = float32 LE xyz × n、 faces = uint32 LE 頂点 index × 3 × m を base64 で持つ。
  /// transform は row-major 4x4 (= realtime_handpose.jsonl の camera_transform と同じ流儀、 world 座標へ)。
  private func writeMeshJsonl(into dir: URL) {
    guard let anchors = session.currentFrame?.anchors else { return }
    let meshAnchors = anchors.compactMap { $0 as? ARMeshAnchor }
    guard !meshAnchors.isEmpty else {
      NSLog("[ArkitCaptureController] no mesh anchors to export")
      return
    }
    let url = dir.appendingPathComponent("mesh.jsonl")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    guard let handle = try? FileHandle(forWritingTo: url) else { return }
    defer { try? handle.close() }

    for anchorObj in meshAnchors {
      let g = anchorObj.geometry

      let vCount = g.vertices.count
      var verts = [Float]()
      verts.reserveCapacity(vCount * 3)
      let vBase = g.vertices.buffer.contents().advanced(by: g.vertices.offset)
      for i in 0..<vCount {
        let pv = vBase.advanced(by: i * g.vertices.stride).assumingMemoryBound(to: Float.self)
        verts.append(pv[0]); verts.append(pv[1]); verts.append(pv[2])
      }

      let fCount = g.faces.count
      let idxPer = g.faces.indexCountPerPrimitive
      var faces = [UInt32]()
      faces.reserveCapacity(fCount * idxPer)
      let fBase = g.faces.buffer.contents()
      let bytesPerIndex = g.faces.bytesPerIndex
      for i in 0..<(fCount * idxPer) {
        let off = i * bytesPerIndex
        if bytesPerIndex == 4 {
          faces.append(fBase.advanced(by: off).assumingMemoryBound(to: UInt32.self).pointee)
        } else {
          faces.append(UInt32(fBase.advanced(by: off).assumingMemoryBound(to: UInt16.self).pointee))
        }
      }

      let t = anchorObj.transform
      let rows: [[Float]] = [
        [t.columns.0[0], t.columns.1[0], t.columns.2[0], t.columns.3[0]],
        [t.columns.0[1], t.columns.1[1], t.columns.2[1], t.columns.3[1]],
        [t.columns.0[2], t.columns.1[2], t.columns.2[2], t.columns.3[2]],
        [t.columns.0[3], t.columns.1[3], t.columns.2[3], t.columns.3[3]],
      ]
      let vData = verts.withUnsafeBufferPointer { Data(buffer: $0) }
      let fData = faces.withUnsafeBufferPointer { Data(buffer: $0) }
      let line: [String: Any] = [
        "identifier": anchorObj.identifier.uuidString,
        "transform": rows,
        "vertex_count": vCount,
        "face_count": fCount,
        "vertices_b64": vData.base64EncodedString(),
        "faces_b64": fData.base64EncodedString(),
      ]
      if let data = try? JSONSerialization.data(withJSONObject: line, options: []) {
        try? handle.write(contentsOf: data)
        try? handle.write(contentsOf: Data("\n".utf8))
      }
    }
    NSLog("[ArkitCaptureController] mesh.jsonl written: %d anchors", meshAnchors.count)
  }

  private func finalizeDepthTar() {
    guard let h = depthTarHandle else { return }
    try? h.write(contentsOf: Data(count: 1024))
    try? h.synchronize()
    try? h.close()
    depthTarHandle = nil
  }

  /// ustar 形式の 512-byte ヘッダを組む (= regular file)。
  private static func tarHeader(name: String, size: Int) -> Data {
    var h = [UInt8](repeating: 0, count: 512)
    func put(_ s: String, _ offset: Int, _ maxLen: Int) {
      for (i, b) in Array(s.utf8).prefix(maxLen).enumerated() { h[offset + i] = b }
    }
    put(name, 0, 100)                            // name (= "depth/NNNNNN.png"、 100 byte 上限)
    put("0000644", 100, 7)                       // mode (octal)
    put("0000000", 108, 7)                       // uid
    put("0000000", 116, 7)                       // gid
    put(String(format: "%011o", size), 124, 11)  // size (octal)
    put("00000000000", 136, 11)                  // mtime (octal、 0)
    for i in 148..<156 { h[i] = 0x20 }           // chksum 欄は計算前は space 8 個
    h[156] = UInt8(ascii: "0")                   // typeflag '0' = regular file
    put("ustar", 257, 5)                         // magic "ustar\0"
    put("00", 263, 2)                            // version
    var sum = 0
    for b in h { sum += Int(b) }
    put(String(format: "%06o", sum), 148, 6)     // chksum (6 octal)
    h[154] = 0                                   // null
    h[155] = 0x20                                // space
    return Data(h)
  }

  private func appendImuLine(motion: CMDeviceMotion) {
    guard let handle = imuFileHandle else { return }
    // 正規スキーマ (= gen-dummy-sensors.py + gtsam_eval.py が期待):
    //   timestamp_ns: int
    //   accel: {x, y, z}    (= userAccel + gravity、 重力込みの absolute 加速度)
    //   gyro:  {x, y, z}    (= rotationRate)
    //   mag (optional): {x, y, z}
    //   device_motion (optional): {attitude, user_accel, gravity, rotation_rate}
    let tsNs: Int64 = Int64(motion.timestamp * 1_000_000_000.0)
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
        // 同様: ObjC 例外を Swift error 化するため throwing 版を使う。
        try handle.write(contentsOf: data)
        try handle.write(contentsOf: Data("\n".utf8))
      } catch {
        NSLog("[ArkitCaptureController] imu.jsonl write failed: %@", "\(error)")
      }
    }
  }

  /// metadata.json (DATA_SPECS §2.2): セッション中不変の静的情報。 超広角構成 (wide-capture) と
  /// 同形 (recording_config / device_model / os / app_version / camera / calibration_baseline) に
  /// 揃えつつ、 ARKit 固有の intrinsics (fx/fy/cx/cy) + depth を camera に足す。
  /// calibration_baseline は撮影 UI のキャリブレーション工程で確定するため null (UI/dataflow が後で merge)。
  private func writeMetadataJson(into dir: URL, frame: ARFrame) {
    let url = dir.appendingPathComponent("metadata.json")
    let k = frame.camera.intrinsics
    let res = frame.camera.imageResolution
    let fps: Double = {
      if let cfg = session.configuration as? ARWorldTrackingConfiguration {
        return Double(cfg.videoFormat.framesPerSecond)
      }
      return 30.0
    }()
    let fx = k.columns.0[0]
    // 水平 FOV (度) = 2·atan(width / (2·fx))
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
      "fx": fx, "fy": k.columns.1[1], "cx": k.columns.2[0], "cy": k.columns.2[1],
    ]
    // LiDAR 機なら depth 解像度 + intrinsics も載せる (= ARFrame.sceneDepth が存在する場合のみ)。
    if let depth = frame.sceneDepth {
      let dW = CVPixelBufferGetWidth(depth.depthMap)
      let dH = CVPixelBufferGetHeight(depth.depthMap)
      let sx = Float(dW) / Float(res.width)
      let sy = Float(dH) / Float(res.height)
      camera["depth"] = [
        "width": dW, "height": dH,
        "fx": k.columns.0[0] * sx, "fy": k.columns.1[1] * sy,
        "cx": k.columns.2[0] * sx, "cy": k.columns.2[1] * sy,
      ]
    }

    // 書き出し fps は間引き後の実効値 (= mp4 / jsonl の実レート)。 sensor fps は camera.fps。
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

  /// ARCamera.TrackingState を Pipeline 2 メタデータ採点が期待する整数値に写像。
  /// gen-dummy-sensors.py が `tracking_state: 2` (normal) を使うのに揃える。
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
          self.latestHandOutputLock.lock()
          self.latestHandOutput = out
          self.latestHandOutputLock.unlock()
          self.delegate?.arkitCapture(didTrackHand: out)
        }
      }
    }

    // 録画 (= AVAssetWriter に pixelBuffer を append + realtime_handpose.jsonl 行 append)。 録画中のみ。
    if let adaptor = self.pixelBufferAdaptor, let writer = self.assetWriter {
      // 書き出しレート (= recordingRate) への間引き。 ARFrame N 枚に 1 枚だけ mp4 + jsonl に書く。
      let arIdx = recArFrameCounter
      recArFrameCounter += 1
      guard arIdx % recFrameStride == 0 else { return }
      // realtime_handpose.jsonl は書き出す frame に 1 行ずつ。 RGB frame と frame_index を揃える
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
  private func pickPreferredFormat(resolution: String) -> ARConfiguration.VideoFormat? {
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

    // 1x (wide) カメラのみを候補にする (= 0.5x は別の撮影構成 ultra_wide が担う)。
    var pool = supported
    if #available(iOS 16.0, *) {
      let wides = supported.filter { $0.captureDeviceType == .builtInWideAngleCamera }
      if !wides.isEmpty { pool = wides }
    }

    // 解像度設定。 "720p" / "1080p" は 16:9 の切り出し (= 画角は狭くなる)、 該当が無ければ
    // デフォルト (= 4:3 フルセンサー最大画角) に落ちる。
    switch resolution {
    case "720p":
      if let f = pool.min(by: { abs($0.imageResolution.height - 720) < abs($1.imageResolution.height - 720) }),
         abs(f.imageResolution.height - 720) <= 120 { return f }
      fallthrough
    case "1080p":
      if let f = pool.min(by: { abs($0.imageResolution.height - 1080) < abs($1.imageResolution.height - 1080) }),
         abs(f.imageResolution.height - 1080) <= 120 { return f }
      fallthrough
    default:
      // "1440p": フルセンサー 4:3 を優先 (= 最大画角)。 同じアスペクトなら画角は同じなので
      // 最小解像度で十分 (= 1920x1440。 4K はファイルが 4 倍)。 同解像度なら高 fps。
      return pool.min { a, b in
        let aspectA = a.imageResolution.height / a.imageResolution.width
        let aspectB = b.imageResolution.height / b.imageResolution.width
        if abs(aspectA - aspectB) > 0.01 { return aspectA > aspectB }
        let areaA = a.imageResolution.width * a.imageResolution.height
        let areaB = b.imageResolution.width * b.imageResolution.height
        if areaA != areaB { return areaA < areaB }
        return a.framesPerSecond > b.framesPerSecond
      }
    }
  }
}
