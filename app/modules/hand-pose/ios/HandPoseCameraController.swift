import AVFoundation
import Foundation
import UIKit
import CoreImage

// HandPosePreviewView 専用の AVCaptureSession 管理クラス。
//
// 設計:
//   - sandbox 検証フェーズの独立性を優先し、sensor-session 側 CameraSessionController とは別の
//     AVCaptureSession を持つ。統合実装フェーズで一本化する想定 (Plan: shared session + multiple
//     consumers via AVCaptureMultiCamSession か、capture pipeline 抽象化)。
//   - back wide-angle camera 固定。前面カメラ切替は v0.1.2 sandbox では不要。
//   - AVCaptureVideoDataOutput を frame consumer (HandPoseDetector) に渡す。
//   - alwaysDiscardsLateVideoFrames=true で backpressure 自動破棄 (handler 側で詰まったら frame を捨てる)。

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
  let session = AVCaptureSession()
  private let configQueue = DispatchQueue(label: "io.rootlens.hand-pose.camera-config")
  private let captureQueue = DispatchQueue(label: "io.rootlens.hand-pose.video-data", qos: .userInitiated)

  private var configured = false
  private let videoDataOutput = AVCaptureVideoDataOutput()

  weak var consumer: HandPoseFrameConsumer?

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

    session.sessionPreset = .hd1280x720  // hand pose には十分。Vision の処理コストを抑える

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

    // Vision (CoreML) は BGRA を最も扱いやすい
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
      // capture buffer は portrait 向きで JS-side / overlay と一致させる
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

  private static func defaultBackCamera() -> AVCaptureDevice? {
    AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
  }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension HandPoseCameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(_ output: AVCaptureOutput,
                     didOutput sampleBuffer: CMSampleBuffer,
                     from connection: AVCaptureConnection) {
    guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    guard let consumer = consumer else { return }

    // CMSampleBufferGetPresentationTimeStamp は CMTime (HOST_TIME 相当)。
    // mach_absolute_time とは少しズレるが、frame timeline 識別子として十分。
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    let ns: UInt64
    if pts.isValid {
      ns = UInt64(CMTimeGetSeconds(pts) * 1_000_000_000)
    } else {
      ns = monotonicNanosecondsHandPose()
    }

    // capture connection で portrait に立てているので orientation は up
    let orientation: CGImagePropertyOrientation = .up

    let width = CVPixelBufferGetWidth(pixelBuffer)
    let height = CVPixelBufferGetHeight(pixelBuffer)
    let imageSize = CGSize(width: width, height: height)

    consumer.handlePixelBuffer(pixelBuffer,
                               timestampNs: ns,
                               orientation: orientation,
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
