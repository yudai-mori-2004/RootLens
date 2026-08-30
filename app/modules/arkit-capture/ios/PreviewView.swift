import ARKit
import ExpoModulesCore
import SceneKit
import UIKit

// ARKit preview view. Render-only.
//
// This view never starts or stops the session. The ARSession lifecycle is
// owned exclusively by the JS layer (arkitConfig.startSession/stopSession →
// ArkitCaptureController); the view just attaches to that session and draws.
//
// ⚠ An earlier version auto-started the session in didMoveToWindow. That let
//    view mount/unmount race the JS-side camera serialization, and two capture
//    stacks fighting over the camera (an exclusive resource) crashed
//    FigCaptureSession. Keeping session control in one place (JS) removes the
//    race by construction.
//
// Aspect behavior: ARSCNView fills its viewport with the camera image and crops
// when ratios differ. Instead, the scnView frame is sized to exactly the camera
// ratio and fitted inside this view (aspect-fit / contain), so nothing is
// cropped and the full recorded field of view is visible. The leftover area
// becomes black bars. Fit was chosen over fill because a cropped preview reads
// as "the recording is cropped too".
//
// The camera aspect comes from the videoFormat ARKit selected (e.g. 1920x1440, 4:3).

final class ArkitCapturePreviewView: ExpoView {
  private let scnView = ARSCNView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    addSubview(scnView)
    scnView.session = ArkitCaptureController.shared.arSession
    scnView.automaticallyUpdatesLighting = true
    HardwareCaptureEventController.shared.registerHostView(self)
    // Screen-dim support for long recordings: stop rendering at 60 fps under a
    // black screen, saving the GPU and bandwidth heat.
    NotificationCenter.default.addObserver(
      self, selector: #selector(onDimChanged(_:)), name: .rootlensPreviewDim, object: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

  deinit {
    HardwareCaptureEventController.shared.unregisterHostView(self)
    NotificationCenter.default.removeObserver(self)
  }

  @objc private func onDimChanged(_ n: Notification) {
    let dimmed = (n.userInfo?["dimmed"] as? Bool) ?? false
    scnView.isHidden = dimmed
    // The display link can keep running even while hidden, so drop the render rate too (0 restores the default).
    scnView.preferredFramesPerSecond = dimmed ? 1 : 0
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    layoutScnViewAspectFit()
  }

  // Convert the camera (sensor) aspect to the display orientation and compute
  // the scnView frame that aspect-fits it into this view.
  //
  // - Sensor ratio: e.g. ARWorldTracking at 1920×1440 (4:3 landscape).
  // - In portrait the camera renders rotated 90°, so the ratio inverts to 3:4.
  // - In landscape it stays 4:3.
  // The frame fills the view bounds as far as the display-space camera ratio allows.
  private func layoutScnViewAspectFit() {
    let viewW = bounds.width
    let viewH = bounds.height
    guard viewW > 0, viewH > 0 else { return }

    // Resolution of the videoFormat ARKit selected.
    let sensorRes = ArkitCaptureController.shared.currentSensorResolution()
    let sensorW = sensorRes.width > 0 ? sensorRes.width : 1920
    let sensorH = sensorRes.height > 0 ? sensorRes.height : 1440

    // Camera ratio in display space (w / h). ARKit's capturedImage is in the
    // sensor's native landscape orientation; portrait rendering rotates it 90°,
    // inverting the ratio.
    let isPortrait = viewH > viewW
    let cameraAR: CGFloat = isPortrait
      ? sensorH / sensorW   // portrait: 1440/1920 = 0.75
      : sensorW / sensorH   // landscape: 1920/1440 = 1.33

    let viewAR = viewW / viewH

    let scnW: CGFloat
    let scnH: CGFloat
    if viewAR > cameraAR {
      // View is wider than the camera: fit by height, black bars left and right.
      scnH = viewH
      scnW = viewH * cameraAR
    } else {
      // View is taller than the camera: fit by width, black bars top and bottom.
      scnW = viewW
      scnH = viewW / cameraAR
    }
    let target = CGRect(x: (viewW - scnW) / 2, y: (viewH - scnH) / 2, width: scnW, height: scnH)
    // Touch the frame only when it actually changes, so every layout pass does not jitter the render.
    if !scnView.frame.equalTo(target) {
      scnView.frame = target
    }

    // Before the session starts the sensor resolution is unknown and a default
    // ratio is used, so schedule one re-layout for after it settles
    // (layoutSubviews only fires on bounds changes, hence the manual retry).
    if sensorRes.width == 0, !relayoutScheduled {
      relayoutScheduled = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.relayoutScheduled = false
        self?.setNeedsLayout()
      }
    }
  }

  private var relayoutScheduled = false
}
