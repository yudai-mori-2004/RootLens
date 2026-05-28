import Foundation
import AVFoundation
import CoreMedia
import CoreImage
import CoreVideo
import UIKit

// AVCaptureSession ベースの撮影 controller (= ARKit 廃止後の置換)。
//
// 役割:
//   1. AVCaptureSession + 背面 ultra-wide camera (= .builtInUltraWideCamera) を所有
//   2. videoDataOutput callback で sample buffer を受け取り、 HandTracker + Recorder に流す
//   3. delegate (= WideCaptureControllerDelegate) 経由で HandTracker output を Module に push
//   4. snapshot / orientation / start-stop 系の AsyncFunction を提供 (= Module から呼ばれる)
//
// thread:
//   - 主操作 (= start/stopSession, start/stopRecording, snapshot) はすべて captureQueue 上で
//     serialize する (= AVCaptureSession の add/remove は同期で main 以外 OK だが、 race を
//     避けるため serial queue で一本化)
//   - sample buffer callback は captureQueue で呼ばれる
//   - HandTracker は CPU 重め (Vision)、 captureQueue 上で同期実行 (= frame drop 許容)
//
// singleton: AVCaptureSession + 物理デバイスは OS リソースで multi instance 厳禁。
// arkit-capture と同じ pattern で WideCaptureController.shared。

// MARK: - 公開 enum

enum WideCaptureDisplayOrientation {
  case portrait
  case landscapeLeft
  case landscapeRight
}

protocol WideCaptureControllerDelegate: AnyObject {
  func wideCapture(didTrackHand output: HandTracker.Output)
}

final class WideCaptureController: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {

  static let shared = WideCaptureController()

  weak var delegate: WideCaptureControllerDelegate?

  // MARK: - AVCaptureSession
  let session = AVCaptureSession()
  private var videoDeviceInput: AVCaptureDeviceInput?
  private let videoDataOutput = AVCaptureVideoDataOutput()
  private let captureQueue = DispatchQueue(label: "io.rootlens.widecapture.capture", qos: .userInitiated)

  // MARK: - HandTracker
  private let handTracker = HandTracker()

  // MARK: - Recorder
  private let recorder = WideCaptureRecorder()

  // MARK: - 状態
  private var sessionStarted = false
  private var displayOrientation: WideCaptureDisplayOrientation = .landscapeRight

  /// preview view 側から読まれる現在の orientation (= main thread 同期参照、 race を避けるため
  /// captureQueue 経由の update 後に main で反映される pattern)
  var currentDisplayOrientation: WideCaptureDisplayOrientation { displayOrientation }

  // MARK: - preview view registry
  // setDisplayOrientation 時に preview layer 側も同期更新するため、 view 参照を弱保持する。
  private var previewViews = NSHashTable<WideCapturePreviewView>.weakObjects()

  func registerPreviewView(_ view: WideCapturePreviewView) {
    DispatchQueue.main.async { [weak self] in
      self?.previewViews.add(view)
    }
  }

  func unregisterPreviewView(_ view: WideCapturePreviewView) {
    DispatchQueue.main.async { [weak self] in
      self?.previewViews.remove(view)
    }
  }

  // MARK: - snapshot 用 latest pixel buffer
  private var latestPixelBuffer: CVPixelBuffer?
  private let snapshotLock = NSLock()

  private override init() {
    super.init()
  }

  // MARK: - availability

  static func isUltraWideAvailable() -> Bool {
    return AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) != nil
  }

  // MARK: - session 起動 / 停止

  func startSession() {
    captureQueue.sync {
      guard !sessionStarted else { return }
      do {
        try configureSessionLocked()
        session.startRunning()
        sessionStarted = true
      } catch {
        NSLog("[WideCaptureController] startSession failed: %@", "\(error)")
      }
    }
  }

  func stopSession() {
    captureQueue.sync {
      guard sessionStarted else { return }
      session.stopRunning()
      sessionStarted = false
    }
  }

  // MARK: - 構成 (captureQueue 上から呼ばれる)

  private func configureSessionLocked() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    // 一旦 既存 input / output を全部外して再構成可能に
    session.inputs.forEach { session.removeInput($0) }
    session.outputs.forEach { session.removeOutput($0) }

    if session.canSetSessionPreset(.hd1920x1080) {
      session.sessionPreset = .hd1920x1080
    } else {
      session.sessionPreset = .high
    }

    // ultra-wide camera を強制
    guard let device = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) else {
      throw NSError(
        domain: "WideCaptureController", code: 10,
        userInfo: [NSLocalizedDescriptionKey: "builtInUltraWideCamera unavailable on this device"])
    }
    // 30 fps lock (= DATA_SPECS §2.2 準拠)
    try device.lockForConfiguration()
    if let format = device.formats.first(where: { fmt in
      let dim = CMVideoFormatDescriptionGetDimensions(fmt.formatDescription)
      return dim.width == 1920 && dim.height == 1080
        && fmt.videoSupportedFrameRateRanges.contains(where: { $0.maxFrameRate >= 30 })
    }) {
      device.activeFormat = format
    }
    device.activeVideoMinFrameDuration = CMTime(value: 1, timescale: 30)
    device.activeVideoMaxFrameDuration = CMTime(value: 1, timescale: 30)
    device.unlockForConfiguration()

    let input = try AVCaptureDeviceInput(device: device)
    guard session.canAddInput(input) else {
      throw NSError(
        domain: "WideCaptureController", code: 11,
        userInfo: [NSLocalizedDescriptionKey: "Cannot add ultra-wide camera input"])
    }
    session.addInput(input)
    self.videoDeviceInput = input

    // video data output (= sample buffer callback)
    videoDataOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    ]
    videoDataOutput.alwaysDiscardsLateVideoFrames = true
    videoDataOutput.setSampleBufferDelegate(self, queue: captureQueue)
    guard session.canAddOutput(videoDataOutput) else {
      throw NSError(
        domain: "WideCaptureController", code: 12,
        userInfo: [NSLocalizedDescriptionKey: "Cannot add video data output"])
    }
    session.addOutput(videoDataOutput)

    // camera intrinsics 配信を ON (= ultra-wide 対応端末のみ有効、 不可ならログのみ)
    if let connection = videoDataOutput.connection(with: .video) {
      if connection.isCameraIntrinsicMatrixDeliverySupported {
        connection.isCameraIntrinsicMatrixDeliveryEnabled = true
      }
      applyOrientationToConnection(connection)
    }
  }

  // MARK: - 録画 start / stop

  /// sessionDir を渡されたらそこに超広角構成のファイルを並走出力。 戻り値は session dir の URL。
  func startRecording(sessionDir: URL) throws -> URL {
    var result: Result<URL, Error>!
    captureQueue.sync {
      do {
        let videoSize = CGSize(width: 1920, height: 1080)
        let metadata = self.buildSessionMetadata(videoSize: videoSize)
        let url = try recorder.start(dir: sessionDir, videoSize: videoSize, metadata: metadata)
        result = .success(url)
      } catch {
        result = .failure(error)
      }
    }
    switch result! {
    case .success(let url): return url
    case .failure(let err): throw err
    }
  }

  /// metadata.json の中身 (DATA_SPECS §2.2)。 セッション中不変の静的情報をまとめる。
  /// calibration_baseline は撮影 UI のキャリブレーション工程で確定するため、 ここでは null
  /// (= UI / dataflow 層がキャリブレーション後に merge する想定。 sandbox 撮影では null のまま)。
  private func buildSessionMetadata(videoSize: CGSize) -> [String: Any] {
    var fovDeg = 0.0
    var width = Int(videoSize.width)
    var height = Int(videoSize.height)
    if let device = videoDeviceInput?.device {
      fovDeg = Double(device.activeFormat.videoFieldOfView)
      let dim = CMVideoFormatDescriptionGetDimensions(device.activeFormat.formatDescription)
      width = Int(dim.width)
      height = Int(dim.height)
    }
    return [
      "recording_config": "ultra_wide",
      "device_model": Self.deviceModelIdentifier(),
      "os_name": "iOS",
      "os_version": UIDevice.current.systemVersion,
      "app_version": Self.appVersionString(),
      "camera": [
        "lens": "ultra_wide",
        "field_of_view_deg": fovDeg,
        "width": width,
        "height": height,
        "fps": 30,
      ],
      "calibration_baseline": NSNull(),
    ]
  }

  /// 端末モデル識別子 (= "iPhone15,2" 等)。 UIDevice.model は generic なので utsname を使う。
  private static func deviceModelIdentifier() -> String {
    var sysinfo = utsname()
    uname(&sysinfo)
    let id = withUnsafeBytes(of: &sysinfo.machine) { raw -> String in
      let bytes = raw.bindMemory(to: CChar.self)
      return String(cString: bytes.baseAddress!)
    }
    return id.isEmpty ? "unknown" : id
  }

  private static func appVersionString() -> String {
    let info = Bundle.main.infoDictionary
    let v = info?["CFBundleShortVersionString"] as? String ?? "?"
    let b = info?["CFBundleVersion"] as? String ?? "?"
    return "\(v) (\(b))"
  }

  /// 録画停止 (= AVAssetWriter finalize + file handle close + CoreMotion stop)。
  /// 戻り値は session dir の URL。 完了は同期待ち (= writer.finishWriting は async、 semaphore で待つ)。
  func stopRecording() throws -> URL {
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<URL, Error>!
    recorder.stop { r in
      result = r
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 30)
    switch result! {
    case .success(let url): return url
    case .failure(let err): throw err
    }
  }

  // MARK: - snapshot

  /// 最新 sample frame を JPEG として temp に書き出し、 file:// URI を返す。
  func captureSnapshot() throws -> URL {
    snapshotLock.lock()
    let pb = latestPixelBuffer
    snapshotLock.unlock()
    guard let pixelBuffer = pb else {
      throw NSError(
        domain: "WideCaptureController", code: 20,
        userInfo: [NSLocalizedDescriptionKey: "No frame available yet"])
    }

    let ci = CIImage(cvPixelBuffer: pixelBuffer)
    let ctx = CIContext(options: nil)
    guard let cg = ctx.createCGImage(ci, from: ci.extent) else {
      throw NSError(
        domain: "WideCaptureController", code: 21,
        userInfo: [NSLocalizedDescriptionKey: "Failed to create CGImage"])
    }
    let ui = UIImage(cgImage: cg)
    guard let data = ui.jpegData(compressionQuality: 0.85) else {
      throw NSError(
        domain: "WideCaptureController", code: 22,
        userInfo: [NSLocalizedDescriptionKey: "Failed to encode JPEG"])
    }
    let tmp = NSTemporaryDirectory()
    let url = URL(fileURLWithPath: "\(tmp)widecapture_snapshot_\(Int(Date().timeIntervalSince1970 * 1000)).jpg")
    try data.write(to: url, options: .atomic)
    return url
  }

  // MARK: - orientation

  func setDisplayOrientation(_ o: WideCaptureDisplayOrientation) {
    captureQueue.async { [weak self] in
      guard let self = self else { return }
      self.displayOrientation = o
      if let conn = self.videoDataOutput.connection(with: .video) {
        self.applyOrientationToConnection(conn)
      }
      // preview layer 側も同期更新 (= UI thread 経由で view.applyOrientation を呼ぶ)
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        for view in self.previewViews.allObjects {
          view.applyOrientation(o)
        }
      }
    }
  }

  private func applyOrientationToConnection(_ connection: AVCaptureConnection) {
    let target: AVCaptureVideoOrientation
    switch displayOrientation {
    case .portrait:        target = .portrait
    case .landscapeLeft:   target = .landscapeLeft
    case .landscapeRight:  target = .landscapeRight
    }
    if connection.isVideoOrientationSupported {
      connection.videoOrientation = target
    }
  }

  // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    // snapshot 用 latest 更新
    snapshotLock.lock()
    latestPixelBuffer = pixelBuffer
    snapshotLock.unlock()

    // hand tracking (= Vision request、 CPU 重い)
    let timestampNs = UInt64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1e9)
    let orientation = cgOrientationFromConnection(connection)
    let handOutput = handTracker.process(
      pixelBuffer: pixelBuffer,
      orientation: orientation,
      timestampNs: timestampNs
    )

    // delegate (= Module の onHandTrack event)
    DispatchQueue.main.async { [weak self] in
      self?.delegate?.wideCapture(didTrackHand: handOutput)
    }

    // recorder (= 録画中なら rgb.mp4 + realtime_handpose.jsonl + metadata.json に並走出力)
    recorder.ingestSampleBuffer(sampleBuffer, handTrack: handOutput) { [weak self] in
      // 60 分自動停止 trigger (= 別 queue で stop を呼ぶ、 callback queue から呼ぶと deadlock)
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          _ = try self?.stopRecording()
        } catch {
          NSLog("[WideCaptureController] auto-stop failed: %@", "\(error)")
        }
      }
    }
  }

  private func cgOrientationFromConnection(_ connection: AVCaptureConnection) -> CGImagePropertyOrientation {
    // videoOrientation は AVCaptureVideoOrientation、 CGImagePropertyOrientation に写像
    if connection.isVideoOrientationSupported {
      switch connection.videoOrientation {
      case .portrait:            return .right
      case .portraitUpsideDown:  return .left
      case .landscapeLeft:       return .down
      case .landscapeRight:      return .up
      @unknown default:          return .right
      }
    }
    return .right
  }
}
