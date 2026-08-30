import AVFoundation
import ExpoModulesCore

final class IphoneCapturePreviewView: ExpoView {
  private let previewLayer = AVCaptureVideoPreviewLayer()

  required init(appContext: AppContext? = nil) {
    previewLayer.videoGravity = .resizeAspect
    super.init(appContext: appContext)
    layer.addSublayer(previewLayer)
    previewLayer.session = IphoneCaptureController.shared.session
    IphoneCaptureController.shared.registerPreview(self)
    HardwareCaptureEventController.shared.registerHostView(self)
  }

  deinit {
    HardwareCaptureEventController.shared.unregisterHostView(self)
    IphoneCaptureController.shared.unregisterPreview(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    previewLayer.frame = bounds
    applyOrientation(IphoneCaptureController.shared.currentDisplayOrientation())
  }

  func applyOrientation(_ orientation: DisplayOrientation) {
    guard let connection = previewLayer.connection, connection.isVideoOrientationSupported else { return }
    switch orientation {
    case .portrait: connection.videoOrientation = .portrait
    case .landscapeLeft: connection.videoOrientation = .landscapeLeft
    case .landscapeRight: connection.videoOrientation = .landscapeRight
    }
  }
}
