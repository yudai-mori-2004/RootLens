import AVFoundation
import Foundation
import UIKit
import CoreImage

// HandPose 用 AVCaptureSession を Process 内で 1 個だけ持つ singleton。
//
// 設計:
//   - sandbox 検証フェーズの独立性を優先し、sensor-session 側 CameraSessionController とは別の
//     AVCaptureSession を持つ。統合実装フェーズで一本化する想定 (Plan: shared session + multiple
//     consumers via AVCaptureMultiCamSession か、capture pipeline 抽象化)。
//   - back wide-angle camera 固定。前面カメラ切替は v0.1.2 sandbox では不要。
//   - AVCaptureVideoDataOutput を frame consumer (HandPoseDetector) に流す。
//   - 同じ frame stream を VideoRecorder にも分岐させて mp4 化 (sandbox 04: collection flow)。
//   - latest pixel buffer を保持し、captureSnapshot() で JPEG ファイル化して返す (VLM check 用)。
//   - alwaysDiscardsLateVideoFrames=true で backpressure 自動破棄。

protocol HandPoseFrameConsumer: AnyObject {
  /// CMSampleBuffer の pixel buffer + 撮像時刻 + 向き を渡す。
  /// 呼び出し側 (capture queue) で同期的に処理して返るまでに次フレームの delivery が遅れるのは許容。
  /// 重い処理を行う場合は consumer 内部で background queue に逃がすこと。
  func handlePixelBuffer(_ pixelBuffer: CVPixelBuffer,
                         timestampNs: UInt64,
                         orientation: CGImagePropertyOrientation,
                         imageSize: CGSize)
}

final class HandPoseCameraController: NSObject {
  static let shared = HandPoseCameraController()

  let session = AVCaptureSession()
  private let configQueue = DispatchQueue(label: "io.rootlens.hand-pose.camera-config")
  private let captureQueue = DispatchQueue(label: "io.rootlens.hand-pose.video-data", qos: .userInitiated)

  private var configured = false
  private let videoDataOutput = AVCaptureVideoDataOutput()

  /// 現在 frame を消費する HandPosePreviewView (mount 時に self を set、unmount で nil)
  weak var consumer: HandPoseFrameConsumer?

  /// 動画録画用。startRecording で writer 構築、stop で finalize。
  let recorder = VideoRecorder()

  /// 直近の pixel buffer (CIImage 経由で JPEG 化するため retain しておく)。capture queue 上で更新。
  /// snapshot 取得時にこの buffer を使う。
  private let latestBufferLock = NSLock()
  private var latestBuffer: CVPixelBuffer?
  private var latestBufferOrientation: CGImagePropertyOrientation = .up

  private override init() {
    super.init()
  }

  // MARK: - Configuration / lifecycle

  func configureIfNeeded() throws {
    var captured: Error?
    configQueue.sync {
      if configured { return }
      do {
        try configureLocked()
        configured = true
      } catch { captured = error }
    }
    if let e = captured { throw e }
  }

  private func configureLocked() throws {
    session.beginConfiguration()
    defer { session.commitConfiguration() }

    session.sessionPreset = .hd1280x720

    guard let device = Self.defaultBackCamera() else {
      throw NSError(domain: "HandPoseCameraController", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "no back camera"])
    }
    let input = try AVCaptureDeviceInput(device: device)
    if session.canAddInput(input) {
      session.addInput(input)
    } else {
      throw NSError(domain: "HandPoseCameraController", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add camera input"])
    }

    videoDataOutput.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    videoDataOutput.alwaysDiscardsLateVideoFrames = true
    videoDataOutput.setSampleBufferDelegate(self, queue: captureQueue)

    if session.canAddOutput(videoDataOutput) {
      session.addOutput(videoDataOutput)
    } else {
      throw NSError(domain: "HandPoseCameraController", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "cannot add video data output"])
    }

    if let connection = videoDataOutput.connection(with: .video) {
      if #available(iOS 17.0, *) {
        if connection.isVideoRotationAngleSupported(90) {
          connection.videoRotationAngle = 90
        }
      } else {
        if connection.isVideoOrientationSupported {
          connection.videoOrientation = .portrait
        }
      }
    }
  }

  func startIfNeeded() {
    configQueue.async {
      if !self.session.isRunning { self.session.startRunning() }
    }
  }

  func stopIfNeeded() {
    configQueue.async {
      if self.session.isRunning { self.session.stopRunning() }
    }
  }

  // MARK: - Snapshot

  /// 直近 frame を JPEG として temp directory に書き出し、ファイル URL を返す。
  /// frame が無ければ throw。VLM 開始/終了判定で使う。
  func captureSnapshot(quality: CGFloat = 0.8) async throws -> URL {
    return try await withCheckedThrowingContinuation { continuation in
      captureQueue.async {
        self.latestBufferLock.lock()
        let buffer = self.latestBuffer
        let orientation = self.latestBufferOrientation
        self.latestBufferLock.unlock()

        guard let pixelBuffer = buffer else {
          continuation.resume(throwing: NSError(
            domain: "HandPoseCameraController", code: 10,
            userInfo: [NSLocalizedDescriptionKey: "no frame available yet"]
          ))
          return
        }

        let ciImage = CIImage(cvPixelBuffer: pixelBuffer).oriented(orientation)
        let context = CIContext()
        guard
          let cgImage = context.createCGImage(ciImage, from: ciImage.extent)
        else {
          continuation.resume(throwing: NSError(
            domain: "HandPoseCameraController", code: 11,
            userInfo: [NSLocalizedDescriptionKey: "failed to create CGImage"]
          ))
          return
        }
        let uiImage = UIImage(cgImage: cgImage)
        guard let data = uiImage.jpegData(compressionQuality: quality) else {
          continuation.resume(throwing: NSError(
            domain: "HandPoseCameraController", code: 12,
            userInfo: [NSLocalizedDescriptionKey: "failed to encode JPEG"]
          ))
          return
        }

        let dir = NSTemporaryDirectory()
        let path = "\(dir)hand_pose_snapshot_\(monotonicNanosecondsHandPose()).jpg"
        let url = URL(fileURLWithPath: path)
        do {
          try data.write(to: url)
          continuation.resume(returning: url)
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  // MARK: - Recording

  /// 録画開始。outputPath 空なら temp に生成。録画中ならエラー。
  func startRecording(outputPath: String) throws -> URL {
    let url: URL
    if outputPath.isEmpty {
      let dir = NSTemporaryDirectory()
      url = URL(fileURLWithPath: "\(dir)rootlens_collection_\(monotonicNanosecondsHandPose()).mp4")
    } else {
      url = URL(fileURLWithPath: outputPath)
    }
    // capture 解像度は session preset 由来 (hd1280x720)。portrait 回転で w/h 入れ替わる。
    let dims = CGSize(width: 720, height: 1280)
    try recorder.startRecording(to: url, dimensions: dims)
    return url
  }

  /// 録画停止。完了時に出力 URL を返す。
  func stopRecording() async throws -> URL {
    return try await withCheckedThrowingContinuation { continuation in
      recorder.stopRecording { url in
        if let url = url {
          continuation.resume(returning: url)
        } else {
          continuation.resume(throwing: NSError(
            domain: "HandPoseCameraController", code: 20,
            userInfo: [NSLocalizedDescriptionKey: "stopRecording: not recording or failed to finalize"]
          ))
        }
      }
    }
  }

  // MARK: - Helpers

  /// Ultra-wide (0.5x, 13mm equiv) → wide (1x, 26mm) の優先順で取得。
  /// egocentric な家事撮影では両手 + 作業領域を収めるために FOV 広い方が良い。
  /// iPhone 12 / 13 / 14 / 15 / 16 はいずれも builtInUltraWideCamera を持つ。
  /// SE 等 ultra-wide 非搭載端末は builtInWideAngleCamera にフォールバック。
  private static func defaultBackCamera() -> AVCaptureDevice? {
    if let ultra = AVCaptureDevice.default(.builtInUltraWideCamera, for: .video, position: .back) {
      return ultra
    }
    return AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension HandPoseCameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

    // 1. Recording があれば録画 writer に渡す (consumer 有無に関係なく走らせる)
    recorder.appendSampleBuffer(sampleBuffer)

    // 2. latest buffer を更新 (snapshot 用)
    latestBufferLock.lock()
    latestBuffer = pixelBuffer
    latestBufferOrientation = .up   // capture connection で portrait にしてあるため
    latestBufferLock.unlock()

    // 3. consumer (HandPosePreviewView) に流す
    guard let consumer = consumer else { return }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let ns: UInt64
    if pts.isValid {
      ns = UInt64(CMTimeGetSeconds(pts) * 1_000_000_000)
    } else {
      ns = monotonicNanosecondsHandPose()
    }

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let imageSize = CGSize(width: width, height: height)

    consumer.handlePixelBuffer(pixelBuffer,
                               timestampNs: ns,
                               orientation: .up,
                               imageSize: imageSize)
  }
}

// MARK: - Helpers

func monotonicNanosecondsHandPose() -> UInt64 {
  var info = mach_timebase_info_data_t()
  mach_timebase_info(&info)
  let t = mach_absolute_time()
  return UInt64(Double(t) * Double(info.numer) / Double(info.denom))
}
