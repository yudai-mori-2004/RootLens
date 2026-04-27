package io.rootlens.sensorsession.sensors

import android.content.Context
import android.os.SystemClock
import android.util.Log
import io.rootlens.sensorsession.NativeSensor
import io.rootlens.sensorsession.SensorDescriptor
import io.rootlens.sensorsession.SensorResult
import io.rootlens.sensorsession.SensorTimeWindow
import io.rootlens.sensorsession.stream.NativeSensorStreamHandle
import io.rootlens.sensorsession.stream.StreamCapableSensor
import io.rootlens.sensorsession.stream.StreamParams
import io.rootlens.sensorsession.stream.StreamRecorder

/**
 * Camera2Sensor — NativeSensor 実装。CameraSessionController.get(context) を経由して
 * 静止画 capture を行う。
 *
 * exclusivityGroup="android.camera2" (Camera2 系 / ARCore Session の排他)
 *
 * payload は CameraCharacteristics + TotalCaptureResult のプロパティをそのまま
 * JSON 化したもののみ。RootLens 独自分類は持たない。
 */
class Camera2Sensor(private val appContext: Context) : NativeSensor, StreamCapableSensor {
  override val id: String = "android.camera2.builtin_back_default"
  override val exclusivityGroup: String? = "android.camera2"
  // VideoEncoder drain thread が format change 時に muxer.start を呼ぶ → StreamSession で最後に並べる
  override val startsMuxer: Boolean = true

  override suspend fun descriptor(): SensorDescriptor {
    val controller = CameraSessionController.get(appContext)
    return try {
      controller.configureIfNeeded()
      SensorDescriptor(
        id = id,
        exclusivityGroup = exclusivityGroup,
        available = true,
        apiDescriptor = controller.currentDeviceDescriptor()
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
      // captureBundle: anchorMonotonicNs を key にして Camera2Depth16Sensor と 1 トリガーを共有
      val bundle = controller.captureBundle(window.anchorMonotonicNs)
      val photo = bundle.jpeg
      val payload = mapOf(
        "output_path" to photo.outputPath,
        "result_metadata" to photo.resultMetadata,
        "device" to photo.deviceInfo,
        "depth_co_captured" to (bundle.depth != null),
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
        startNs = photo.captureNs,
        endNs = photo.endNs
      )
    } catch (t: Throwable) {
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

  // -------------------- StreamCapableSensor (Task 03) --------------------

  override suspend fun startStream(
    recorder: StreamRecorder,
    params: StreamParams
  ): NativeSensorStreamHandle {
    val controller = CameraSessionController.get(appContext)
    val encoder = controller.startVideoStream(recorder)
    return Camera2VideoStreamHandle(
      sensorId = id,
      controller = controller,
      encoder = encoder,
      recorder = recorder,
      params = params
    )
  }
}

/**
 * Camera2 動画録画 1 セッション分のハンドル。
 * stop で encoder を flush + Camera2 セッションを写真モードに戻す。
 */
private class Camera2VideoStreamHandle(
  private val sensorId: String,
  private val controller: CameraSessionController,
  private val encoder: VideoEncoder,
  private val recorder: StreamRecorder,
  private val params: StreamParams
) : NativeSensorStreamHandle {
  companion object { private const val TAG = "Camera2Stream" }

  private val streamStartNs: Long = SystemClock.elapsedRealtimeNanos()

  override suspend fun stop(): SensorResult {
    val streamEndNs = SystemClock.elapsedRealtimeNanos()
    encoder.stop()
    controller.stopVideoStream()

    val payload = mapOf(
      "output_path" to recorder.outputPath,
      "device" to controller.currentDeviceDescriptor(),
      "video" to mapOf(
        "width" to encoder.widthValue,
        "height" to encoder.heightValue,
        "encoder_mime" to "video/avc",
        "container_mime" to "video/mp4"
      ),
      "window" to mapOf(
        "start_ns_wallclock" to params.windowStartNs.toULong().toString(),
        "stream_start_monotonic_ns" to streamStartNs.toULong().toString(),
        "stream_end_monotonic_ns" to streamEndNs.toULong().toString(),
        "duration_ms" to ((streamEndNs - streamStartNs) / 1_000_000L).toInt()
      )
    )
    return SensorResult(
      sensorId = sensorId,
      apiPath = sensorId,
      kind = "stream",
      payload = payload,
      startNs = streamStartNs,
      endNs = streamEndNs
    )
  }

  override suspend fun abort() {
    try { encoder.stop() } catch (_: Throwable) {}
    try { controller.stopVideoStream() } catch (_: Throwable) {}
    Log.i(TAG, "aborted")
  }
}
