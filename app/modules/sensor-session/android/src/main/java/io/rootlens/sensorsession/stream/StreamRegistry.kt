package io.rootlens.sensorsession.stream

import android.content.Context
import io.rootlens.sensorsession.SensorRegistry
import io.rootlens.sensorsession.SensorResult
import java.util.UUID

/**
 * 動画 stream 録画 (Task 03) を管理する registry。
 * streamId → StreamSession のマッピングを保持し、start / stop / abort をディスパッチする。
 */
class StreamRegistry {
  private val sessions: MutableMap<String, StreamSession> = HashMap()
  private val lock = Any()

  suspend fun start(
    ctx: Context,
    sensorRegistry: SensorRegistry,
    sensorIds: List<String>,
    windowStartNs: Long,
    windowLookbackMs: Int,
    anchorMonotonicNs: Long,
    outputPath: String
  ): String {
    val streamId = UUID.randomUUID().toString()
    val session = StreamSession(
      ctx = ctx,
      streamId = streamId,
      sensorRegistry = sensorRegistry,
      sensorIds = sensorIds,
      windowStartNs = windowStartNs,
      windowLookbackMs = windowLookbackMs,
      anchorMonotonicNs = anchorMonotonicNs,
      outputPath = outputPath
    )
    session.start()
    synchronized(lock) { sessions[streamId] = session }
    return streamId
  }

  suspend fun stop(streamId: String): List<SensorResult> {
    val session = synchronized(lock) { sessions.remove(streamId) }
      ?: throw IllegalArgumentException("unknown streamId: $streamId")
    return session.stop()
  }

  suspend fun abort(streamId: String) {
    val session = synchronized(lock) { sessions.remove(streamId) } ?: return
    session.abort()
  }
}
