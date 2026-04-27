import AVFoundation
import Foundation

/// CameraSensor — NativeSensor 実装。AVCaptureSession (CameraSessionController.shared) を
/// 経由して静止画 capture を行う。
///
/// exclusivityGroup = "ios.av_session" (AVCaptureSession 系 / ARSession 系の排他)
///
/// payload には AVCapturePhoto.metadata + resolvedSettings + AVCaptureDevice descriptor を
/// そのまま JSON 化したもののみを格納する。RootLens 独自分類 (T0/T1 等) は持たない。
final class CameraSensor: NativeSensor {
  let id: String = "ios.av_capture_session.builtin_back_default"
  let exclusivityGroup: String? = "ios.av_session"

  func descriptor() async -> SensorDescriptor {
    let controller = CameraSessionController.shared
    do {
      try controller.configureIfNeeded()
    } catch {
      return SensorDescriptor(
        id: id,
        exclusivityGroup: exclusivityGroup,
        available: false,
        apiDescriptor: ["configure_error": String(describing: error)],
        unavailableReason: error.localizedDescription
      )
    }
    let info = controller.currentDeviceDescriptor()
    return SensorDescriptor(
      id: id,
      exclusivityGroup: exclusivityGroup,
      available: true,
      apiDescriptor: info,
      unavailableReason: nil
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let controller = CameraSessionController.shared
    do {
      let bundle = try await controller.captureBundle(anchorKey: window.anchorMonotonicNs)
      let photo = bundle.photo
      var payload: [String: Any] = [
        "output_path": photo.outputPath,
        "metadata": photo.metadata,
        "resolved_settings": photo.resolvedSettings,
        "device": photo.deviceInfo,
        "depth_co_captured": bundle.depth != nil
      ]
      payload["window"] = [
        "start_ns": String(window.startNs),
        "duration_ms": window.durationMs
      ]
      return SensorResult(
        sensorId: id,
        apiPath: id,
        kind: "point",
        payload: payload,
        startNs: photo.captureNs,
        endNs: photo.endNs,
        unavailableReason: nil
      )
    } catch {
      return SensorResult(
        sensorId: id,
        apiPath: id,
        kind: "unavailable",
        payload: ["error": error.localizedDescription],
        startNs: window.startNs,
        endNs: window.startNs,
        unavailableReason: error.localizedDescription
      )
    }
  }
}
