package io.rootlens.sensorsession

import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import android.hardware.camera2.CameraCharacteristics
import io.rootlens.sensorsession.sensors.Camera2Depth16Sensor
import io.rootlens.sensorsession.sensors.Camera2Sensor
import io.rootlens.sensorsession.sensors.CameraSessionController
import io.rootlens.sensorsession.sensors.SensorEventCatalog
import io.rootlens.sensorsession.sensors.SensorEventController
import io.rootlens.sensorsession.sensors.SensorEventSensor
import io.rootlens.sensorsession.stream.StreamRegistry
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// 抽象センサー層 — Android 側 Expo Module スカフォールド
//
// Phase 1 では module 定義 + native 列挙 IF + capture IF のシグネチャまで。
// 実 sensor (Camera2Sensor / SensorEvent 系) は Phase 2 / 3 で本実装。

class SensorSessionModule : Module() {
  // 登録された native sensor 群。Phase 2/3 で Camera2Sensor / SensorEvent 系を register する。
  private val sensorRegistry = SensorRegistry()

  // Phase 2/3 で coroutine 内で sensor I/O を回すためのスコープ
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  // 動画 stream 録画 (Task 03) の管理。streamId → StreamSession のマッピング
  private val streamRegistry = StreamRegistry()

  override fun definition() = ModuleDefinition {
    Name("SensorSession")

    OnCreate {
      val ctx = appContext.reactContext ?: return@OnCreate
      val app = ctx.applicationContext
      sensorRegistry.register(Camera2Sensor(app))
      sensorRegistry.register(Camera2Depth16Sensor(app))

      // SensorEvent 系: SensorManager で実機列挙し、利用可能な TYPE_* それぞれを ISensor として登録
      val controller = SensorEventController.get(app)
      for (entry in SensorEventCatalog.defaults()) {
        val id = SensorEventCatalog.idFor(entry.typeName)
        // listener は ensureSensor() の中で登録される (常時稼働 = 撮影前から ringbuffer 蓄積)
        controller.ensureSensor(id, entry.typeInt)
        sensorRegistry.register(SensorEventSensor(app, id, entry.typeInt, entry.typeName))
      }
    }

    View(SensorPreviewView::class) {
      // Phase 2: プロパティなし (zoom/focus/orientation は Task 05 で追加)
    }

    AsyncFunction("listAvailableSensors") { promise: Promise ->
      scope.launch {
        try {
          val descriptors = sensorRegistry.listDescriptors()
          promise.resolve(descriptors.map { it.toMap() })
        } catch (t: Throwable) {
          promise.reject("SENSOR_SESSION_ERROR", t.message ?: "listAvailableSensors failed", t)
        }
      }
    }

    // -------------------- Task 03: 動画 stream 録画 --------------------

    AsyncFunction("startStream") {
        sensorIds: List<String>, windowStartNs: String, windowLookbackMs: Int, outputPath: String, promise: Promise ->
      scope.launch {
        try {
          val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
          val anchorMonotonicNs = SystemClock.elapsedRealtimeNanos()
          val startNs = windowStartNs.toULongOrNull()?.toLong() ?: 0L
          val finalOutputPath = if (outputPath.isNotEmpty()) outputPath else
            java.io.File(ctx.cacheDir, "rootlens_video_${System.currentTimeMillis()}.mp4").absolutePath
          val streamId = streamRegistry.start(
            ctx = ctx.applicationContext,
            sensorRegistry = sensorRegistry,
            sensorIds = sensorIds,
            windowStartNs = startNs,
            windowLookbackMs = windowLookbackMs,
            anchorMonotonicNs = anchorMonotonicNs,
            outputPath = finalOutputPath
          )
          promise.resolve(streamId)
        } catch (t: Throwable) {
          promise.reject("STREAM_START_ERROR", t.message ?: "startStream failed", t)
        }
      }
    }

    AsyncFunction("stopStream") { streamId: String, promise: Promise ->
      scope.launch {
        try {
          val results = streamRegistry.stop(streamId)
          promise.resolve(results.map { it.toMap() })
        } catch (t: Throwable) {
          promise.reject("STREAM_STOP_ERROR", t.message ?: "stopStream failed", t)
        }
      }
    }

    AsyncFunction("abortStream") { streamId: String, promise: Promise ->
      scope.launch {
        try {
          streamRegistry.abort(streamId)
          promise.resolve(null)
        } catch (t: Throwable) {
          promise.reject("STREAM_ABORT_ERROR", t.message ?: "abortStream failed", t)
        }
      }
    }

    // -------------------- カメラ切替 (Task 05) --------------------

    AsyncFunction("switchCamera") { facing: String, promise: Promise ->
      scope.launch {
        try {
          val ctx = appContext.reactContext ?: throw IllegalStateException("no react context")
          val target = when (facing.lowercase()) {
            "front" -> CameraCharacteristics.LENS_FACING_FRONT
            "back" -> CameraCharacteristics.LENS_FACING_BACK
            else -> throw IllegalArgumentException("facing must be 'front' or 'back', got: $facing")
          }
          CameraSessionController.get(ctx.applicationContext).switchCameraFacing(target)
          promise.resolve(null)
        } catch (t: Throwable) {
          promise.reject("SWITCH_CAMERA_ERROR", t.message ?: "switchCamera failed", t)
        }
      }
    }

    // -------------------- 静止画 capture (Task 02) --------------------

    AsyncFunction("capture") {
        sensorIds: List<String>, windowStartNs: String, windowDurationMs: Int, windowLookbackMs: Int, promise: Promise ->
      scope.launch {
        try {
          // anchor: ネイティブ層 capture 入口で記録する monotonic ns。
          // SensorEvent.timestamp / CaptureResult.SENSOR_TIMESTAMP と同一時間軸のため、
          // IMU リングバッファ slice に使う基準になる。
          // (JS-side の windowStartNs は wall-clock epoch ns で時間軸が異なるため slice には使えない)
          val anchorMonotonicNs = SystemClock.elapsedRealtimeNanos()
          val startNs = windowStartNs.toULongOrNull()?.toLong() ?: 0L
          val window = SensorTimeWindow(
            startNs = startNs,
            durationMs = windowDurationMs,
            lookbackMs = windowLookbackMs,
            anchorMonotonicNs = anchorMonotonicNs
          )
          val results = sensorRegistry.capture(sensorIds, window)
          promise.resolve(results.map { it.toMap() })
        } catch (t: Throwable) {
          promise.reject("SENSOR_SESSION_ERROR", t.message ?: "capture failed", t)
        }
      }
    }
  }
}

// MARK: - 共通型

/**
 * 撮影窓 (Android native 内部表現)。
 *  - startNs       : JS-side 由来 wall-clock ns (Date.now()*1e6)。assertion 内の wall-clock 記録に使う。
 *                    SensorEvent.timestamp とは時間軸が違うため slice には使えない。
 *  - durationMs    : 0 なら静止画、>0 なら動画 (Task 03)。
 *  - lookbackMs    : window 開始前のルックバック ms (静止画 IMU 用)。
 *  - anchorMonotonicNs : ネイティブ層 capture 入口で記録した SystemClock.elapsedRealtimeNanos。
 *                        SensorEvent.timestamp / CaptureResult.SENSOR_TIMESTAMP と同軸。
 *                        IMU リングバッファの slice 基準。
 */
data class SensorTimeWindow(
  val startNs: Long,
  val durationMs: Int,
  val lookbackMs: Int,
  val anchorMonotonicNs: Long
)

data class SensorDescriptor(
  val id: String,
  val exclusivityGroup: String?,
  val available: Boolean,
  val apiDescriptor: Map<String, Any?>,
  val unavailableReason: String? = null
) {
  fun toMap(): Map<String, Any?> {
    val m = mutableMapOf<String, Any?>(
      "id" to id,
      "exclusivity_group" to exclusivityGroup,
      "available" to available,
      "api_descriptor" to apiDescriptor
    )
    if (unavailableReason != null) m["unavailable_reason"] = unavailableReason
    return m
  }
}

data class SensorResult(
  val sensorId: String,
  val apiPath: String,
  val kind: String,           // "point" | "stream" | "unavailable"
  val payload: Any?,
  val startNs: Long,
  val endNs: Long,
  val unavailableReason: String? = null
) {
  fun toMap(): Map<String, Any?> {
    val m = mutableMapOf<String, Any?>(
      "sensor_id" to sensorId,
      "api_path" to apiPath,
      "kind" to kind,
      "payload" to payload,
      "timestamp" to mapOf(
        "start_ns" to startNs.toULong().toString(),
        "end_ns" to endNs.toULong().toString()
      )
    )
    if (unavailableReason != null) m["unavailable_reason"] = unavailableReason
    return m
  }
}

interface NativeSensor {
  val id: String
  val exclusivityGroup: String?
  suspend fun descriptor(): SensorDescriptor
  suspend fun capture(window: SensorTimeWindow): SensorResult
}

class SensorRegistry {
  // OnCreate でのみ登録、以降は read-only 想定。同時変更を避けるため synchronized で守る。
  private val sensors: LinkedHashMap<String, NativeSensor> = LinkedHashMap()

  fun register(s: NativeSensor) {
    synchronized(sensors) {
      if (!sensors.containsKey(s.id)) sensors[s.id] = s
    }
  }

  /** id で 1 個取り出す。StreamSession から呼ぶ */
  fun snapshotSensor(id: String): NativeSensor? = synchronized(sensors) { sensors[id] }

  private fun snapshot(): List<NativeSensor> = synchronized(sensors) { sensors.values.toList() }

  suspend fun listDescriptors(): List<SensorDescriptor> = withContext(Dispatchers.Default) {
    snapshot().map { it.descriptor() }
  }

  suspend fun capture(ids: List<String>, window: SensorTimeWindow): List<SensorResult> =
    withContext(Dispatchers.Default) {
      val snap = synchronized(sensors) { ids.mapNotNull { sensors[it] } }
      val deferreds = snap.map { s -> async { s.capture(window) } }
      deferreds.awaitAll()
    }
}
