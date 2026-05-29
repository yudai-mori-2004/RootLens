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

  /// HandTracker / Vision に渡す向き。 sensor landscape buffer をこの表示向きとして解釈させる。
  var cgImageOrientation: CGImagePropertyOrientation {
    switch self {
    case .portrait:       return .right   // 90° CW: sensor landscape → display portrait
    case .landscapeRight: return .up      // identity (= sensor native)
    case .landscapeLeft:  return .down    // 180°
    }
  }

  /// AVAssetWriterInput.transform に渡す回転。 sensor landscape (1920×1080) を表示向きに回す
  /// (= ARKit 側 ArSessionController.DisplayOrientation.videoTransform と同一)。
  var videoTransform: CGAffineTransform {
    switch self {
    case .landscapeRight: return .identity
    case .landscapeLeft:  return CGAffineTransform(rotationAngle: .pi)        // 180°
    case .portrait:       return CGAffineTransform(rotationAngle: .pi / 2)    // 90° CW
    }
  }
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
  // 既定は portrait (= ARKit 側と統一)。 DevSandbox など向きを明示設定しない呼出元でも縦向き録画になる。
  // 旧 landscape 撮影画面は setDisplayOrientation で動的に上書きする。
  private var displayOrientation: WideCaptureDisplayOrientation = .portrait

  /// preview view 側から読まれる現在の orientation (= main thread 同期参照、 race を避けるため
  /// captureQueue 経由の update 後に main で反映される pattern)
  var currentDisplayOrientation: WideCaptureDisplayOrientation { displayOrientation }

  // MARK: - preview view registry
  // setDisplayOrientation 時に preview layer 側も同期更新するため、 view 参照を弱保持する。
  private var previewViews = NSHashTable<WideCapturePreviewView>.weakObjects()

  func registerPreviewView(_ view: WideCapturePreviewView) {
    if Thread.isMainThread {
      previewViews.add(view)
    } else {
      DispatchQueue.main.async { [weak self] in self?.previewViews.add(view) }
    }
  }

  func unregisterPreviewView(_ view: WideCapturePreviewView) {
    // ⚠ deinit から呼ばれる。 以前は DispatchQueue.main.async に view を捕捉していたが、
    //   それだと「解放中の view」を escaping closure が強参照し、 後で main キューが
    //   そのブロックを実行する際に objc_retain で EXC_BAD_ACCESS (SIGSEGV) を起こす。
    //   これが構成切替 (ultra_wide → arkit) で preview がアンマウントされた瞬間の
    //   クラッシュの真因だった。 dying view を escaping closure に持ち越さないこと。
    //   main 上なら同期で外す。 非 main の場合は previewViews が weakObjects なので
    //   解放後に自動 purge される (= ここで何もしなくて良い)。
    if Thread.isMainThread {
      previewViews.remove(view)
    }
  }

  // MARK: - snapshot 用 latest pixel buffer
  private var latestPixelBuffer: CVPixelBuffer?
  private let snapshotLock = NSLock()

  private override init() {
    super.init()
    // セッションの中断 / runtime error を監視する (= 構成切替を繰り返した際のカメラ競合や
    // media services reset で writer が cancelled になる事象の可視化 + 自己復帰)。
    let nc = NotificationCenter.default
    nc.addObserver(self, selector: #selector(sessionRuntimeError(_:)),
                   name: .AVCaptureSessionRuntimeError, object: session)
    nc.addObserver(self, selector: #selector(sessionWasInterrupted(_:)),
                   name: .AVCaptureSessionWasInterrupted, object: session)
    nc.addObserver(self, selector: #selector(sessionInterruptionEnded(_:)),
                   name: .AVCaptureSessionInterruptionEnded, object: session)
  }

  // MARK: - session 中断 / runtime error (= 自己復帰 + 診断ログ)

  @objc private func sessionRuntimeError(_ note: Notification) {
    let err = note.userInfo?[AVCaptureSessionErrorKey] as? NSError
    NSLog("[WideCaptureController] session runtime error: %@", "\(err?.localizedDescription ?? "?")")
    // media services reset 等の回復可能エラーは startRunning で復帰を試みる。
    captureQueue.async { [weak self] in
      guard let self = self, self.sessionStarted, !self.session.isRunning else { return }
      self.session.startRunning()
    }
  }

  @objc private func sessionWasInterrupted(_ note: Notification) {
    let reason = note.userInfo?[AVCaptureSessionInterruptionReasonKey]
    NSLog("[WideCaptureController] session interrupted (reason=%@)", "\(reason ?? "?")")
  }

  @objc private func sessionInterruptionEnded(_ note: Notification) {
    NSLog("[WideCaptureController] session interruption ended")
    captureQueue.async { [weak self] in
      guard let self = self, self.sessionStarted, !self.session.isRunning else { return }
      self.session.startRunning()
    }
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

  // 構成切替 (ultra_wide → arkit) でカメラ (= 排他リソース) を ARSession へ確実に明け渡すための停止。
  // ⚠ 単純な stopRunning() だけでは ARSession が同じ ultra-wide カメラを掴んだ瞬間に
  //   FigCaptureSession が assert クラッシュする。 原因は 2 つ:
  //     (a) stopRunning() は非同期。 戻ってもキャプチャサーバの teardown は完了していない。
  //         → AVCaptureSessionDidStopRunning 通知を待って「解放完了」を観測してから返す。
  //     (b) 保持中の CVPixelBuffer / Vision (HandTracker) が掴んだ IOSurface が宙に浮く。
  //         dying session の buffer pool の IOSurface が所有 task を失い、 kernel が
  //         "buffer->fClientTask = 0x0 not found" を連発、 次の session で破綻する。
  //         → delegate を外して callback を止め、 in-flight の captureOutput / HandTracker を
  //           drain し (captureQueue 直列実行)、 latestPixelBuffer を解放する。
  // stopSession は WideCaptureModule が global queue 上で呼ぶので、 通知待ちで block してよい
  // (= main を固めない)。
  func stopSession() {
    guard sessionStarted else { return }

    // 1) 新規 callback を止め、 in-flight の captureOutput / HandTracker を drain し、
    //    保持中の pixel buffer を解放する (= IOSurface を宙に浮かせない)。
    captureQueue.sync {
      videoDataOutput.setSampleBufferDelegate(nil, queue: nil)
      snapshotLock.lock()
      latestPixelBuffer = nil
      snapshotLock.unlock()
    }

    // 2) stopRunning() の完了 (= キャプチャサーバの teardown) を通知で待つ。
    let stopped = DispatchSemaphore(value: 0)
    let token = NotificationCenter.default.addObserver(
      forName: .AVCaptureSessionDidStopRunning, object: session, queue: nil
    ) { _ in stopped.signal() }
    session.stopRunning()
    _ = stopped.wait(timeout: .now() + 3.0)
    NotificationCenter.default.removeObserver(token)

    // 3) 停止完了後に input/output を外してカメラデバイスを手放す
    //    (= frame in-flight 中に外すと buffer mismatch を誘発するため、 必ず stop 完了後)。
    //    次回 startSession は configureSessionLocked が input/output を再構築する。
    captureQueue.sync {
      session.beginConfiguration()
      session.inputs.forEach { session.removeInput($0) }
      session.outputs.forEach { session.removeOutput($0) }
      session.commitConfiguration()
      videoDeviceInput = nil
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
      // データ出力 buffer は sensor 向き (= landscape 1920×1080) に固定する。 表示向きへの回転は
      // 録画側 (AVAssetWriterInput.transform) と HandTracker (cgImageOrientation) が担う。
      // ここで displayOrientation に追従させると buffer が portrait (1080×1920) になり 1920×1080
      // writer と不一致になる + preview と二重回転する。
      if connection.isVideoOrientationSupported {
        connection.videoOrientation = .landscapeRight
      }
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
        // 録画開始時の表示向きを transform として焼き込む (= sensor landscape → 表示向き)。
        // 録画中は向きを変えない前提 (= intrinsics 固定)。
        let transform = self.displayOrientation.videoTransform
        let url = try recorder.start(dir: sessionDir, videoSize: videoSize, transform: transform, metadata: metadata)
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

    // buffer は sensor landscape 固定なので、 表示向きに回してから JPEG 化する。
    let ci = CIImage(cvPixelBuffer: pixelBuffer).oriented(displayOrientation.cgImageOrientation)
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
      // データ出力 connection は sensor 向き固定なので触らない (= 表示回転は transform / cgImageOrientation)。
      // preview layer 側だけ同期更新する (= UI thread 経由で view.applyOrientation を呼ぶ)。
      DispatchQueue.main.async { [weak self] in
        guard let self = self else { return }
        for view in self.previewViews.allObjects {
          view.applyOrientation(o)
        }
      }
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

    // hand tracking (= Vision request、 CPU 重い)。 buffer は sensor landscape 固定なので、
    // 表示向き (displayOrientation) を Vision に渡して landmark を表示座標系に揃える。
    let timestampNs = UInt64(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer)) * 1e9)
    let orientation = displayOrientation.cgImageOrientation
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

}
