package io.rootlens.sensorsession.sensors

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.HandlerThread

// SensorManager を Process 内で 1 個だけ持つ singleton。
// 各 SensorEventSensor は SensorEventController に listener 登録され、リングバッファに常時蓄積。
//
// 思想 (Don't be the judge):
//   - "raw" / "fused" / "calibrated" / "uncalibrated" の判定はしない。
//     SensorManager の Sensor.TYPE_* に存在する値をすべて 1 ISensor として登録する。
//     consumer (TP Extension / 検証側) が API path を見て解釈する。

class SensorEventController private constructor(private val appContext: Context) {

  companion object {
    @Volatile private var INSTANCE: SensorEventController? = null

    fun get(context: Context): SensorEventController {
      INSTANCE?.let { return it }
      synchronized(this) {
        INSTANCE?.let { return it }
        val c = SensorEventController(context.applicationContext)
        INSTANCE = c
        return c
      }
    }
  }

  val sensorManager: SensorManager =
    appContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

  private val thread = HandlerThread("rootlens-sensor-events").apply { start() }
  private val handler = Handler(thread.looper)

  /** CAMM listener (動画録画中) のための専用 handler。main thread を避ける */
  private val cammThread = HandlerThread("rootlens-camm-listener").apply { start() }
  val cammHandler: Handler = Handler(cammThread.looper)

  // sensor.id (我々が割り当てる string) → (Sensor, RingBuffer, Listener)
  private data class Entry(
    val sensor: Sensor,
    val buffer: SensorEventRingBuffer,
    val listener: SensorEventListener
  )

  private val entries = LinkedHashMap<String, Entry>()
  private val lock = Any()

  /**
   * sensor.type に対応する Android Sensor を取得し、リングバッファ + listener を準備する。
   * 戻り値: 取得できなかった場合 null。取れた場合は (Sensor descriptor, ring buffer)。
   *
   * id は呼び出し側が決定する (例: "android.sensor_event.type_gyroscope")。
   */
  fun ensureSensor(id: String, type: Int): Sensor? {
    synchronized(lock) {
      entries[id]?.let { return it.sensor }
      val sensor = sensorManager.getDefaultSensor(type) ?: return null
      val buffer = SensorEventRingBuffer()
      val listener = object : SensorEventListener {
        override fun onSensorChanged(event: SensorEvent) {
          buffer.push(
            SensorEventSample(
              timestampNs = event.timestamp,
              values = event.values.copyOf(),
              accuracy = event.accuracy
            )
          )
        }
        override fun onAccuracyChanged(s: Sensor, accuracy: Int) { /* noop */ }
      }
      // SENSOR_DELAY_FASTEST: HW 上限 (Android 12+ で 200Hz cap、HIGH_SAMPLING_RATE_SENSORS 権限で解除)
      val ok = sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST, handler)
      if (!ok) return null
      entries[id] = Entry(sensor, buffer, listener)
      return sensor
    }
  }

  fun bufferFor(id: String): SensorEventRingBuffer? =
    synchronized(lock) { entries[id]?.buffer }

  fun sensorFor(id: String): Sensor? =
    synchronized(lock) { entries[id]?.sensor }

  fun unregisterAll() {
    synchronized(lock) {
      entries.values.forEach { sensorManager.unregisterListener(it.listener) }
      entries.clear()
    }
  }
}
