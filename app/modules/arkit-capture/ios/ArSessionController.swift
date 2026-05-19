import ARKit
import AVFoundation
import CoreImage
import CoreVideo
import Foundation
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
  private var recordingOutputURL: URL?

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

  // MARK: - Recording lifecycle (AVAssetWriter MP4)

  func startRecording(to url: URL) throws -> URL {
    if assetWriter != nil {
      throw NSError(domain: "ArkitCaptureController", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "already recording"])
    }
    // 既存ファイルがあれば消す (= 同じ URL に上書き)
    try? FileManager.default.removeItem(at: url)

    // sensor 解像度を取得して AVAssetWriter を構成
    let sensorRes = currentSensorResolution()
    let sensorW = Int(sensorRes.width)
    let sensorH = Int(sensorRes.height)
    if sensorW == 0 || sensorH == 0 {
      throw NSError(domain: "ArkitCaptureController", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "sensor resolution unknown"])
    }

    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
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
    // 表示 orientation を transform で焼く (= 再生時に自動回転)
    input.transform = currentDisplayOrientation().videoTransform

    // ARFrame.capturedImage は kCVPixelFormatType_420YpCbCr8BiPlanarFullRange
    let sourcePixelAttrs: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
      kCVPixelBufferWidthKey as String: sensorW,
      kCVPixelBufferHeightKey as String: sensorH,
    ]
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: sourcePixelAttrs)

    guard writer.canAdd(input) else {
      throw NSError(domain: "ArkitCaptureController", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add video input"])
    }
    writer.add(input)
    writer.startWriting()
    writer.startSession(atSourceTime: .zero)

    self.assetWriter = writer
    self.videoInput = input
    self.pixelBufferAdaptor = adaptor
    self.recordingStartTime = .invalid
    self.recordingOutputURL = url

    if !sessionRunning { startSession() }
    handTracker.setRecordingMode(true)

    return url
  }

  func stopRecording() throws -> URL {
    guard let writer = assetWriter, let input = videoInput, let url = recordingOutputURL else {
      throw NSError(domain: "ArkitCaptureController", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "not recording"])
    }
    handTracker.setRecordingMode(false)

    input.markAsFinished()
    let group = DispatchGroup()
    group.enter()
    writer.finishWriting {
      group.leave()
    }
    group.wait()

    self.assetWriter = nil
    self.videoInput = nil
    self.pixelBufferAdaptor = nil
    self.recordingStartTime = .invalid
    self.recordingOutputURL = nil

    if writer.status == .failed {
      throw writer.error ?? NSError(domain: "ArkitCaptureController", code: 5,
                                    userInfo: [NSLocalizedDescriptionKey: "writer failed"])
    }
    return url
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

    // 録画 (= AVAssetWriter に pixelBuffer を append)。 録画中のみ。
    if let adaptor = self.pixelBufferAdaptor, let writer = self.assetWriter {
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
