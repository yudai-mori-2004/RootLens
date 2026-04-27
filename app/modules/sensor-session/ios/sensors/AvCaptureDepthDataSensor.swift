import AVFoundation
import Foundation

/// AvCaptureDepthDataSensor — AVFoundation の AVCapturePhoto.depthData を NativeSensor として包む。
///
/// - exclusivityGroup = "ios.av_session" → CameraSensor / 将来の AVCapture 系 sensor と協調 (同 session 共有)
/// - capture(window) は CameraSessionController.captureBundle(anchorKey) を呼び、
///   先に CameraSensor が同 anchor で取った bundle の depth 部分を取り出して返す。
/// - depth 非対応機種 (Touch ID iPhone, iPad without TrueDepth/LiDAR/Dual cam) では
///   kind="unavailable" を返す。
///
/// 思想 (Don't be the judge):
///   - LiDAR / TrueDepth / Dual disparity / single-image ML の判定は OS API レスポンスに任せる。
///     `depthDataType` ("DepthFloat32" / "DisparityFloat32" / etc.), `depthDataAccuracy`
///     ("relative" / "absolute"), `isDepthDataFiltered`, intrinsics などをそのまま記録する。
final class AvCaptureDepthDataSensor: NativeSensor {
  let id: String = "ios.av_capture_depth_data.builtin_back_default"
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
    let supported = controller.supportsDepthDataDelivery
    let info: [String: Any] = [
      "depth_data_delivery_supported": supported,
      "device": controller.currentDeviceDescriptor()
    ]
    return SensorDescriptor(
      id: id,
      exclusivityGroup: exclusivityGroup,
      available: supported,
      apiDescriptor: info,
      unavailableReason: supported ? nil : "depth_data_delivery_unsupported"
    )
  }

  func capture(window: SensorTimeWindow) async -> SensorResult {
    let controller = CameraSessionController.shared
    do {
      let bundle = try await controller.captureBundle(anchorKey: window.anchorMonotonicNs)
      guard let depth = bundle.depth else {
        return SensorResult(
          sensorId: id,
          apiPath: id,
          kind: "unavailable",
          payload: [
            "reason": "no_depth_data_in_capture",
            "device": bundle.photo.deviceInfo
          ],
          startNs: window.startNs,
          endNs: window.startNs,
          unavailableReason: "no_depth_data_in_capture"
        )
      }
      let rawB64 = depth.rawBytes.base64EncodedString(options: [])
      let payload: [String: Any] = [
        "depth_data_type": Int(depth.depthDataType),
        "depth_data_type_name": depth.depthDataTypeName,
        "width": depth.width,
        "height": depth.height,
        "bytes_per_row": depth.bytesPerRow,
        "raw_base64": rawB64,
        "raw_bytes_length": depth.rawBytes.count,
        "is_depth_data_filtered": depth.isDepthDataFiltered,
        "depth_data_accuracy": depth.depthDataAccuracy,
        "depth_data_quality": depth.depthDataQuality,
        "camera_calibration": depth.cameraCalibration,
        "device": bundle.photo.deviceInfo,
        "window": [
          "start_ns": String(window.startNs),
          "duration_ms": window.durationMs
        ]
      ]
      return SensorResult(
        sensorId: id,
        apiPath: id,
        kind: "point",
        payload: payload,
        startNs: depth.captureNs,
        endNs: depth.endNs,
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
