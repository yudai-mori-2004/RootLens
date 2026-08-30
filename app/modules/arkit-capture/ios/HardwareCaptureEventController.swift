import AVKit
import UIKit

/// Owns iOS capture events from physical camera controls while the hardware
/// capture flow is active. A single AVCaptureEventInteraction handler receives
/// both volume buttons; `.ended` gives one command per press without key-repeat
/// or system-volume side effects.
final class HardwareCaptureEventController {
  static let shared = HardwareCaptureEventController()

  var onCapture: (() -> Void)?

  private var interaction: AnyObject?
  private weak var hostView: UIView?
  private var wantsEvents = false

  private init() {}

  static var isAvailable: Bool {
    if #available(iOS 17.2, *) { return true }
    return false
  }

  /// Camera preview views register themselves independently of the selected
  /// capture-control flow. This keeps the input strategy orthogonal to the
  /// ARKit / ultra-wide camera backend while ensuring AVKit's interaction is
  /// hosted by the active camera UI, as required by the API's view contract.
  func registerHostView(_ view: UIView) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard hostView !== view else { return }
    detachInteraction()
    hostView = view
    if wantsEvents {
      do { try attachInteraction() }
      catch { NSLog("[CaptureControl] failed to attach hardware events: %@", error.localizedDescription) }
    }
  }

  func unregisterHostView(_ view: UIView) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard hostView === view else { return }
    detachInteraction()
    hostView = nil
  }

  func start() throws {
    dispatchPrecondition(condition: .onQueue(.main))
    wantsEvents = true
    guard interaction == nil else { return }
    guard #available(iOS 17.2, *) else {
      throw Self.error("Hardware capture events require iOS 17.2 or later.")
    }
    // iOS 26 adds its own default capture sound. RootLens has distinct start
    // and stop cues, so suppress the system sound while this flow owns the
    // buttons instead of producing two overlapping signals.
    if #available(iOS 26.0, *) {
      AVCaptureEventInteraction.defaultCaptureSoundDisabled = true
    }
    do {
      try attachInteraction()
    } catch {
      wantsEvents = false
      if #available(iOS 26.0, *) {
        AVCaptureEventInteraction.defaultCaptureSoundDisabled = false
      }
      throw error
    }
  }

  private func attachInteraction() throws {
    guard interaction == nil else { return }
    guard #available(iOS 17.2, *) else {
      throw Self.error("Hardware capture events require iOS 17.2 or later.")
    }
    guard let hostView, hostView.window != nil else {
      throw Self.error("The active camera preview is not available.")
    }
    // The one-handler initializer maps both primary and secondary capture
    // actions to this closure. On iPhone that includes volume down and volume
    // up respectively, so +/- intentionally have identical behavior.
    let eventInteraction = AVCaptureEventInteraction { [weak self] event in
      guard event.phase == .ended else { return }
      NSLog("[CaptureControl] hardware capture event ended")
      self?.onCapture?()
    }
    eventInteraction.isEnabled = true
    hostView.addInteraction(eventInteraction)
    interaction = eventInteraction
    NSLog("[CaptureControl] hardware capture events attached to %@", String(describing: type(of: hostView)))
  }

  func stop() {
    dispatchPrecondition(condition: .onQueue(.main))
    wantsEvents = false
    detachInteraction()
    if #available(iOS 26.0, *) {
      AVCaptureEventInteraction.defaultCaptureSoundDisabled = false
    }
  }

  private func detachInteraction() {
    guard #available(iOS 17.2, *),
          let eventInteraction = interaction as? AVCaptureEventInteraction else {
      interaction = nil
      return
    }
    eventInteraction.isEnabled = false
    eventInteraction.view?.removeInteraction(eventInteraction)
    interaction = nil
  }

  private static func error(_ message: String) -> NSError {
    NSError(
      domain: "io.rootlens.hardware-capture-events",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: message]
    )
  }
}
