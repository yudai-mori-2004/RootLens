package io.rootlens.sensorsession.sensors

import android.content.Context
import android.util.Base64
import android.util.Log
import io.rootlens.sensorsession.NativeSensor
import io.rootlens.sensorsession.SensorDescriptor
import io.rootlens.sensorsession.SensorResult
import io.rootlens.sensorsession.SensorTimeWindow

/**
 * Camera2 DEPTH16 (depth output) を NativeSensor として包む。
 *
 * - exclusivityGroup = "android.camera2" → Camera2Sensor と協調 (同一 capture session)
 * - capture(window) は CameraSessionController.captureBundle(anchorKey) を呼び、
 *   既に Camera2Sensor が同 anchor で捕った bundle の depth 部分を取り出して返す (cooperative)。
 *   depth 非対応機種では kind="unavailable" を返す。
 *
 * 思想 (Don't be the judge):
 *   - Camera2 API が `availableDepthStreamConfigurations` を持っているか持っていないかだけで判断。
 *     物理 ToF か dual-pixel computational かは判定しない。raw bytes + intrinsics + format 名を
 *     そのまま記録し、consumer (TP Extension / 公開ページ) に解釈を委ねる。
 */
class Camera2Depth16Sensor(private val appContext: Context) : NativeSensor {
  override val id: String = "android.camera2.depth16.builtin_back_default"
  override val exclusivityGroup: String? = "android.camera2"

  override suspend fun descriptor(): SensorDescriptor {
    val controller = CameraSessionController.get(appContext)
    return try {
      controller.configureIfNeeded()
      val available = controller.hasDepthSupport()
      SensorDescriptor(
        id = id,
        exclusivityGroup = exclusivityGroup,
        available = available,
        apiDescriptor = mapOf(
          "depth_supported" to available,
          "depth_size" to (controller.currentDepthSize()?.let { mapOf("width" to it.first, "height" to it.second) }),
          "pixel_format" to "DEPTH16",
          "device" to controller.currentDeviceDescriptor()
        ),
        unavailableReason = if (!available) "no_depth_stream_config" else null
      )
    } catch (t: Throwable) {
      SensorDescriptor(
        id = id,
        exclusivityGroup = exclusivityGroup,
        available = false,
        apiDescriptor = mapOf("configure_error" to (t.message ?: "")),
        unavailableReason = t.message ?: "configure failed"
      )
    }
  }

  override suspend fun capture(window: SensorTimeWindow): SensorResult {
    val controller = CameraSessionController.get(appContext)
    return try {
      val bundle = controller.captureBundle(window.anchorMonotonicNs)
      val depth = bundle.depth
      if (depth == null) {
        return SensorResult(
          sensorId = id,
          apiPath = id,
          kind = "unavailable",
          payload = mapOf(
            "reason" to "depth_unsupported_by_camera",
            "device" to bundle.jpeg.deviceInfo
          ),
          startNs = window.startNs,
          endNs = window.startNs,
          unavailableReason = "depth_unsupported_by_camera"
        )
      }

      val rawB64 = Base64.encodeToString(depth.rawBytesLE, Base64.NO_WRAP)
      val payload = mapOf(
        "pixel_format" to depth.pixelFormat,
        "width" to depth.width,
        "height" to depth.height,
        "byte_order" to "little_endian",
        "encoding" to "raw_uint16_le",   // 上位3bit=信頼度, 下位13bit=mm 等 (Camera2 DEPTH16 仕様)
        "raw_base64" to rawB64,
        "raw_bytes_length" to depth.rawBytesLE.size,
        "intrinsics" to depth.intrinsics,
        "device" to depth.deviceInfo,
        "window" to mapOf(
          "start_ns" to window.startNs.toULong().toString(),
          "duration_ms" to window.durationMs
        )
      )

      SensorResult(
        sensorId = id,
        apiPath = id,
        kind = "point",
        payload = payload,
        startNs = depth.captureNs,
        endNs = depth.endNs
      )
    } catch (t: Throwable) {
      Log.w("Camera2Depth16Sensor", "capture failed: ${t.message}", t)
      SensorResult(
        sensorId = id,
        apiPath = id,
        kind = "unavailable",
        payload = mapOf("error" to (t.message ?: "")),
        startNs = window.startNs,
        endNs = window.startNs,
        unavailableReason = t.message ?: "capture failed"
      )
    }
  }
}
