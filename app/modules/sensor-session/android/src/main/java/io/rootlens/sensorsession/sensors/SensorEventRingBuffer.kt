package io.rootlens.sensorsession.sensors

/**
 * 時系列センサーサンプル用のスレッドセーフなリングバッファ。
 * timestampNs は SensorEvent.timestamp (SystemClock.elapsedRealtimeNanos 系) と同じ時間軸。
 */
data class SensorEventSample(
  val timestampNs: Long,
  val values: FloatArray,
  val accuracy: Int
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is SensorEventSample) return false
    return timestampNs == other.timestampNs &&
           values.contentEquals(other.values) &&
           accuracy == other.accuracy
  }
  override fun hashCode(): Int {
    var r = timestampNs.hashCode()
    r = 31 * r + values.contentHashCode()
    r = 31 * r + accuracy
    return r
  }
}

class SensorEventRingBuffer(private val maxSamples: Int = 4096) {
  private val buffer: ArrayDeque<SensorEventSample> = ArrayDeque()
  private val lock = Any()

  fun push(s: SensorEventSample) {
    synchronized(lock) {
      buffer.addLast(s)
      while (buffer.size > maxSamples) buffer.removeFirst()
    }
  }

  fun clear() {
    synchronized(lock) { buffer.clear() }
  }

  /** timestampNs が [startNs, endNs] (inclusive) に入る sample を返す */
  fun sliceByTimestamp(startNs: Long, endNs: Long): List<SensorEventSample> {
    return synchronized(lock) {
      buffer.filter { it.timestampNs in startNs..endNs }
    }
  }

  fun snapshot(): List<SensorEventSample> = synchronized(lock) { buffer.toList() }
}
