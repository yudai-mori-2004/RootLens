package io.rootlens.sensorsession.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
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
 * Android Sensor.TYPE_* で表現される 1 個のセンサーを ISensor として包むクラス。
 *
 * id は OS API path をそのまま使う (例: "android.sensor_event.type_gyroscope_uncalibrated")。
 * exclusivityGroup は null (IMU 系は他とフラットに並列起動可)。
 *
 * 思想 (Don't be the judge):
 *   - Android が独立した Sensor.TYPE_* として提供する API すべてを 1 ISensor として登録する。
 *   - "raw" / "fused" / "calibrated" / "uncalibrated" の判定は持たない。
 *
 * 注: TYPE_GYROSCOPE は OS 内部で bias 補正が入っているケースもあるが、それを「raw」と呼ぶのは
 *     RootLens の判断ではない。ラベル名は OS API path に従う。
 */
class SensorEventSensor(
  private val appContext: Context,
  override val id: String,
  private val sensorType: Int,
  private val typeName: String  // 例: "TYPE_GYROSCOPE_UNCALIBRATED" — descriptor で公開
) : NativeSensor, StreamCapableSensor {

  override val exclusivityGroup: String? = null

  override suspend fun descriptor(): SensorDescriptor {
    val controller = SensorEventController.get(appContext)
    val sensor = controller.ensureSensor(id, sensorType)
    if (sensor == null) {
      return SensorDescriptor(
        id = id, exclusivityGroup = null,
        available = false,
        apiDescriptor = mapOf(
          "type_int" to sensorType,
          "type_name" to typeName,
          "default_sensor_present" to false
        ),
        unavailableReason = "no_default_sensor_for_type"
      )
    }
    return SensorDescriptor(
      id = id, exclusivityGroup = null,
      available = true,
      apiDescriptor = sensorMetadata(sensor)
    )
  }

  override suspend fun capture(window: SensorTimeWindow): SensorResult {
    val controller = SensorEventController.get(appContext)
    val sensor = controller.sensorFor(id)
    val buffer = controller.bufferFor(id)
    if (sensor == null || buffer == null) {
      // descriptor() がまだ呼ばれていない場合に備えて保険で ensure
      controller.ensureSensor(id, sensorType)
    }
    val s2 = controller.sensorFor(id)
    val b2 = controller.bufferFor(id)
    if (s2 == null || b2 == null) {
      return SensorResult(
        sensorId = id, apiPath = id, kind = "unavailable",
        payload = mapOf(
          "type_int" to sensorType,
          "type_name" to typeName,
          "reason" to "no_default_sensor_for_type"
        ),
        startNs = window.startNs, endNs = window.startNs,
        unavailableReason = "no_default_sensor_for_type"
      )
    }

    val (startNs, endNs) = windowRangeNs(window)
    val samples = b2.sliceByTimestamp(startNs, endNs)
    val payload = mapOf(
      "sensor_metadata" to sensorMetadata(s2),
      "samples" to samples.map {
        mapOf(
          "t_ns" to it.timestampNs.toULong().toString(),
          "values" to it.values.toList(),
          "accuracy" to it.accuracy
        )
      },
      "sample_count" to samples.size,
      "window_start_ns" to startNs.toULong().toString(),
      "window_end_ns" to endNs.toULong().toString()
    )

    return SensorResult(
      sensorId = id, apiPath = id, kind = "point",
      payload = payload, startNs = startNs, endNs = endNs
    )
  }

  private fun sensorMetadata(sensor: Sensor): Map<String, Any?> = mapOf(
    "type_int" to sensor.type,
    "type_name" to typeName,
    "string_type" to sensor.stringType,
    "name" to sensor.name,
    "vendor" to sensor.vendor,
    "version" to sensor.version,
    "resolution" to sensor.resolution,
    "max_range" to sensor.maximumRange,
    "min_delay_us" to sensor.minDelay,
    "max_delay_us" to sensor.maxDelay,
    "power_mA" to sensor.power,
    "reporting_mode" to sensor.reportingMode,
    "is_dynamic_sensor" to sensor.isDynamicSensor,
    "is_wake_up_sensor" to sensor.isWakeUpSensor
  )

  private fun windowRangeNs(window: SensorTimeWindow): Pair<Long, Long> {
    // anchor は SystemClock.elapsedRealtimeNanos 由来の monotonic ns。
    // ring buffer (= SensorEvent.timestamp) と同軸なので slice に使える。
    // (JS-side の window.startNs は wall-clock 軸で時間スケールが違うため使わない)
    val lookbackNs = window.lookbackMs.toLong().coerceAtLeast(0) * 1_000_000L
    val durationNs = window.durationMs.toLong().coerceAtLeast(0) * 1_000_000L
    val startNs = (window.anchorMonotonicNs - lookbackNs).coerceAtLeast(0)
    val endNs = window.anchorMonotonicNs + durationNs
    return startNs to endNs
  }

  // -------------------- StreamCapableSensor (Task 03) --------------------
  //
  // 設計:
  //  - CAMM 仕様 (Google CAMM spec) に対応する type のみ CAMM track に書く:
  //      TYPE_ACCELEROMETER → CAMM type=3 (accel m/s²)
  //      TYPE_GYROSCOPE → CAMM type=2 (gyro rad/s)
  //      TYPE_MAGNETIC_FIELD → CAMM type=7 (magnetic μT)
  //  - 上記以外 (fused / uncalibrated / pressure / etc.) は CAMM 標準外なので track には書かず、
  //    ring buffer から stream 期間分を切り出して assertion inline JSON として返す (静止画と同形式)。
  //  - CAMM 対応の 3 種類も「track + inline JSON 両方」で記録する。冗長だが consumer 側の
  //    使い分け (CAMM reader / RootLens 公開ページ) のしやすさを優先。

  override suspend fun startStream(
    recorder: StreamRecorder,
    params: StreamParams
  ): NativeSensorStreamHandle {
    val controller = SensorEventController.get(appContext)
    // ensure listener が常時稼働中 (OnCreate で ensure 済みのはず)
    val sensor = controller.ensureSensor(id, sensorType)
    val streamStartNs = SystemClock.elapsedRealtimeNanos()

    val cammType: Int? = cammTypeFor(sensorType)
    val cammListener: SensorEventListener? = if (cammType != null && sensor != null) {
      // CAMM track を muxer.start() の前に addTrack しておく (idempotent: 複数 sensor で 1 track 共有)
      recorder.addCammTrack()
      attachCammListener(controller, sensor, cammType, recorder)
    } else null

    return SensorEventStreamHandle(
      sensorId = id,
      typeInt = sensorType,
      typeName = typeName,
      controller = controller,
      sensor = sensor,
      streamStartNs = streamStartNs,
      cammListener = cammListener
    )
  }

  private fun cammTypeFor(type: Int): Int? = when (type) {
    Sensor.TYPE_ACCELEROMETER -> 3
    Sensor.TYPE_GYROSCOPE -> 2
    Sensor.TYPE_MAGNETIC_FIELD -> 7
    else -> null
  }

  private fun attachCammListener(
    controller: SensorEventController,
    sensor: Sensor,
    cammType: Int,
    recorder: StreamRecorder
  ): SensorEventListener {
    val listener = object : SensorEventListener {
      override fun onSensorChanged(event: SensorEvent) {
        if (event.values.size >= 3) {
          recorder.writeCammVec3(
            type = cammType,
            x = event.values[0],
            y = event.values[1],
            z = event.values[2],
            timestampNs = event.timestamp
          )
        }
      }
      override fun onAccuracyChanged(s: Sensor, accuracy: Int) {}
    }
    // 専用 handler thread で listener を回す (main thread を避けて並列回避)。
    // SENSOR_DELAY_GAME (50Hz) で十分。FASTEST だと CAMM track 用途には過剰でロック競合を引き起こす。
    controller.sensorManager.registerListener(
      listener,
      sensor,
      SensorManager.SENSOR_DELAY_GAME,
      controller.cammHandler
    )
    return listener
  }

  inner class SensorEventStreamHandle(
    private val sensorId: String,
    private val typeInt: Int,
    private val typeName: String,
    private val controller: SensorEventController,
    private val sensor: Sensor?,
    private val streamStartNs: Long,
    private val cammListener: SensorEventListener?
  ) : NativeSensorStreamHandle {
    override suspend fun stop(): SensorResult {
      val streamEndNs = SystemClock.elapsedRealtimeNanos()

      // CAMM listener detach (常時稼働の base listener は触らない)
      if (cammListener != null) {
        try { controller.sensorManager.unregisterListener(cammListener) } catch (_: Throwable) {}
      }

      // ring buffer から stream 期間 + lookback を切り出し
      val buffer = controller.bufferFor(sensorId)
      val samples = buffer?.sliceByTimestamp(streamStartNs, streamEndNs) ?: emptyList()

      val sensorMeta = sensor?.let { sensorMetadata(it) } ?: mapOf(
        "type_int" to typeInt,
        "type_name" to typeName,
        "default_sensor_present" to false
      )

      val payload = mapOf(
        "sensor_metadata" to sensorMeta,
        "samples" to samples.map {
          mapOf(
            "t_ns" to it.timestampNs.toULong().toString(),
            "values" to it.values.toList(),
            "accuracy" to it.accuracy
          )
        },
        "sample_count" to samples.size,
        "stream_start_ns" to streamStartNs.toULong().toString(),
        "stream_end_ns" to streamEndNs.toULong().toString(),
        "camm_type" to (cammTypeFor(typeInt) ?: -1),
        "camm_track_written" to (cammListener != null)
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
      if (cammListener != null) {
        try { controller.sensorManager.unregisterListener(cammListener) } catch (_: Throwable) {}
      }
    }
  }
}

/**
 * デフォルトで登録すべき Android Sensor TYPE_* の集合。
 * デバイスにセンサーがない場合は ensureSensor() が null を返し、descriptor() が
 * available=false を返す (RootLens は何も判定しない)。
 *
 * 命名規則: id = "android.sensor_event.<type_name_lower>"
 */
object SensorEventCatalog {
  data class Entry(val typeInt: Int, val typeName: String)

  // 主要な motion / position / environment 系。OS API path をそのまま id 化する。
  fun defaults(): List<Entry> = listOf(
    Entry(Sensor.TYPE_ACCELEROMETER, "TYPE_ACCELEROMETER"),
    Entry(Sensor.TYPE_GYROSCOPE, "TYPE_GYROSCOPE"),
    Entry(Sensor.TYPE_MAGNETIC_FIELD, "TYPE_MAGNETIC_FIELD"),
    Entry(Sensor.TYPE_LINEAR_ACCELERATION, "TYPE_LINEAR_ACCELERATION"),
    Entry(Sensor.TYPE_GRAVITY, "TYPE_GRAVITY"),
    Entry(Sensor.TYPE_ROTATION_VECTOR, "TYPE_ROTATION_VECTOR"),
    Entry(Sensor.TYPE_GAME_ROTATION_VECTOR, "TYPE_GAME_ROTATION_VECTOR"),
    Entry(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR, "TYPE_GEOMAGNETIC_ROTATION_VECTOR"),
    Entry(Sensor.TYPE_ACCELEROMETER_UNCALIBRATED, "TYPE_ACCELEROMETER_UNCALIBRATED"),
    Entry(Sensor.TYPE_GYROSCOPE_UNCALIBRATED, "TYPE_GYROSCOPE_UNCALIBRATED"),
    Entry(Sensor.TYPE_MAGNETIC_FIELD_UNCALIBRATED, "TYPE_MAGNETIC_FIELD_UNCALIBRATED"),
    Entry(Sensor.TYPE_PRESSURE, "TYPE_PRESSURE"),
    Entry(Sensor.TYPE_AMBIENT_TEMPERATURE, "TYPE_AMBIENT_TEMPERATURE"),
    Entry(Sensor.TYPE_RELATIVE_HUMIDITY, "TYPE_RELATIVE_HUMIDITY"),
    Entry(Sensor.TYPE_LIGHT, "TYPE_LIGHT"),
    Entry(Sensor.TYPE_PROXIMITY, "TYPE_PROXIMITY"),
    Entry(Sensor.TYPE_STEP_COUNTER, "TYPE_STEP_COUNTER")
  )

  fun idFor(typeName: String): String = "android.sensor_event.${typeName.lowercase()}"
}
