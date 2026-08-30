import ExpoModulesCore
import Foundation

/// Native bridge for capture-control inputs shared by every camera backend.
/// Camera selection (ARKit / iPhone) and control selection (gesture / voice /
/// hardware button) are independent axes; neither module imports the other.
public final class CaptureControlModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CaptureControl")

    Events("onHardwareCaptureEvent")

    OnCreate {
      HardwareCaptureEventController.shared.onCapture = { [weak self] in
        self?.sendEvent("onHardwareCaptureEvent", ["phase": "ended"])
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        HardwareCaptureEventController.shared.stop()
        HardwareCaptureEventController.shared.onCapture = nil
      }
    }

    AsyncFunction("isHardwareCaptureEventAvailable") { () -> Bool in
      HardwareCaptureEventController.isAvailable
    }

    AsyncFunction("startHardwareCaptureEvents") { (promise: Promise) in
      DispatchQueue.main.async {
        do {
          try HardwareCaptureEventController.shared.start()
          promise.resolve(nil)
        } catch {
          promise.reject("HARDWARE_CAPTURE_EVENTS_START_ERROR", error.localizedDescription)
        }
      }
    }

    AsyncFunction("stopHardwareCaptureEvents") { (promise: Promise) in
      DispatchQueue.main.async {
        HardwareCaptureEventController.shared.stop()
        promise.resolve(nil)
      }
    }
  }
}
