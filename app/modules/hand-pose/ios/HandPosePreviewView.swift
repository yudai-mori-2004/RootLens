import ExpoModulesCore
import AVFoundation
import UIKit

// HandPose 撮影用 ExpoView。
//
// 責務:
//   - 自前 AVCaptureSession を持ち AVCaptureVideoPreviewLayer でプレビュー描画
//   - VideoDataOutput frame を HandPoseDetector に流し込み、結果を onHandPose event で emit
//
// JS-side との contract:
//   - paused: bool (default false) — true で frame 配信を停止 (overlay 残像確認等)
//   - onHandPose: per-frame event (timestamp_ns, image_width/height, hands: [{handedness, score, landmarks: [{x,y,z,confidence}]}])

class HandPosePreviewView: ExpoView, HandPoseFrameConsumer {
  let onHandPose = EventDispatcher()

  private let cameraController = HandPoseCameraController.shared
  private let detector = HandPoseDetector()
  private var previewLayer: AVCaptureVideoPreviewLayer?

  // Detector を回す専用 queue。capture queue から飛んでくる frame を逐次処理する。
  // 詰まった場合は AVCaptureVideoDataOutput.alwaysDiscardsLateVideoFrames=true により
  // 古い frame は自動破棄される (新着 frame が来ても backlog しない)。
  private let detectQueue = DispatchQueue(label: "io.rootlens.hand-pose.detect", qos: .userInitiated)
  private var paused: Bool = false
  private var detecting: Bool = false   // 同時 detect 1 個に制限

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    self.backgroundColor = .black
    setupPreviewLayer()

    cameraController.consumer = self
    do {
      try cameraController.configureIfNeeded()
      cameraController.startIfNeeded()
    } catch {
      NSLog("[HandPosePreviewView] camera configure error: \(error)")
    }
  }

  override func removeFromSuperview() {
    cameraController.stopIfNeeded()
    super.removeFromSuperview()
  }

  func setPaused(_ paused: Bool) {
    self.paused = paused
  }

  // MARK: - Preview layer

  private func setupPreviewLayer() {
    let layer = AVCaptureVideoPreviewLayer(session: cameraController.session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = bounds
    self.layer.addSublayer(layer)
    self.previewLayer = layer
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
    if let connection = previewLayer?.connection {
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

  // MARK: - HandPoseFrameConsumer

  func handlePixelBuffer(_ pixelBuffer: CVPixelBuffer,
                         timestampNs: UInt64,
                         orientation: CGImagePropertyOrientation,
                         imageSize: CGSize) {
    if paused { return }
    // 1 detect / time の制限 (再入を弾く)
    if detecting { return }
    detecting = true

    // CVPixelBuffer は capture queue 上で valid だが、別 queue で使うために retain する
    // (Swift では CVPixelBuffer は CFTypeRef で自動 retain/release されるためそのまま渡せる)
    detectQueue.async { [weak self] in
      guard let self = self else { return }
      defer { self.detecting = false }

      let hands: [HandObservation]
      do {
        hands = try self.detector.detect(pixelBuffer: pixelBuffer, orientation: orientation)
      } catch {
        NSLog("[HandPosePreviewView] detect error: \(error)")
        hands = []
      }

      let frame = HandPoseFrame(
        timestampNs: timestampNs,
        imageWidth: Int(imageSize.width),
        imageHeight: Int(imageSize.height),
        hands: hands
      )
      self.onHandPose(frame.toJSON())
    }
  }
}
