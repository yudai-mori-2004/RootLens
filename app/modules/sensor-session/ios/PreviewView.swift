import ExpoModulesCore
import AVFoundation
import UIKit

// 最低限の撮影中ライブプレビュー View (Plan C)
//
// CameraSessionController.shared の AVCaptureSession を AVCaptureVideoPreviewLayer に attach するだけ。
// ズーム/フォーカス/orientation/フラッシュ等の UX は Task 05 で本実装。

class SensorPreviewView: ExpoView {
  private var previewLayer: AVCaptureVideoPreviewLayer?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    self.backgroundColor = .black
    setupPreviewLayer()
  }

  private func setupPreviewLayer() {
    let session = CameraSessionController.shared.session
    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    layer.frame = bounds
    self.layer.addSublayer(layer)
    self.previewLayer = layer

    // session 構成 + 起動 (idempotent)
    do {
      try CameraSessionController.shared.configureIfNeeded()
      CameraSessionController.shared.startIfNeeded()
    } catch {
      NSLog("[SensorPreviewView] configure error: \(error)")
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer?.frame = bounds
    if #available(iOS 17.0, *) {
      previewLayer?.connection?.videoRotationAngle = 90  // 縦向き既定
    } else {
      previewLayer?.connection?.videoOrientation = .portrait
    }
  }
}
