import ExpoModulesCore
import AVFoundation
import UIKit

// AVCaptureSession のプレビュー描画 View。
// WideCaptureController.shared の session を attach する。
// landscape 固定の ultra wide preview。 videoGravity = .resizeAspect (= contain) で、
// 録画される全画角をそのまま見せる (= arkit 側の PreviewView と同じ方針)。
//
// 重要: AVCaptureVideoPreviewLayer の connection.videoOrientation を毎 layout で適用する。
// default は .portrait なので、 landscape 表示時に映像が 90 度ずれる。
// session attach + connection 生成は session running 後でしか起きないため、 init 時の 1 回設定
// だけでは足りない。 layoutSubviews で都度反映する。

final class WideCapturePreviewView: ExpoView {

  private let previewLayer: AVCaptureVideoPreviewLayer

  required init(appContext: AppContext? = nil) {
    let layer = AVCaptureVideoPreviewLayer()
    layer.videoGravity = .resizeAspect
    self.previewLayer = layer
    super.init(appContext: appContext)
    self.layer.addSublayer(previewLayer)
    // controller の session に attach (= session 未起動でも OK、 後で start すれば描画される)
    self.previewLayer.session = WideCaptureController.shared.session
    WideCaptureController.shared.registerPreviewView(self)
  }

  deinit {
    WideCaptureController.shared.unregisterPreviewView(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    // 毎 layout で orientation を反映 (= 初回 connection 生成や orientation 変化を取りこぼさない)
    applyOrientation(WideCaptureController.shared.currentDisplayOrientation)
  }

  func applyOrientation(_ o: WideCaptureDisplayOrientation) {
    guard let conn = previewLayer.connection, conn.isVideoOrientationSupported else { return }
    let target: AVCaptureVideoOrientation
    switch o {
    case .portrait:        target = .portrait
    case .landscapeLeft:   target = .landscapeLeft
    case .landscapeRight:  target = .landscapeRight
    }
    if conn.videoOrientation != target {
      conn.videoOrientation = target
    }
  }
}
