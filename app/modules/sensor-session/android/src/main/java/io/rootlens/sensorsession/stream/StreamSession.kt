package io.rootlens.sensorsession.stream

import android.content.Context
import android.util.Log
import io.rootlens.sensorsession.NativeSensor
import io.rootlens.sensorsession.SensorRegistry
import io.rootlens.sensorsession.SensorResult
import io.rootlens.sensorsession.SensorTimeWindow

/**
 * 1 つの動画 stream 録画セッション。
 *
 * 流れ:
 *  1. start(): StreamRecorder 構築 → 各 NativeSensor が startStream(recorder, params) で
 *               video track / CAMM track を addTrack → recorder.start() (muxer 起動)
 *  2. 録画中: Camera2Sensor / SensorEventSensor が recorder に sample を書き込み続ける
 *  3. stop(): 各 sensor.stop() で flush → recorder.close() で mp4 finalize
 *             → 各 sensor の SensorResult 配列を返す
 */
class StreamSession(
  private val ctx: Context,
  private val streamId: String,
  private val sensorRegistry: SensorRegistry,
  private val sensorIds: List<String>,
  private val windowStartNs: Long,
  private val windowLookbackMs: Int,
  private val anchorMonotonicNs: Long,
  private val outputPath: String
) {
  companion object {
    private const val TAG = "StreamSession"
  }

  private lateinit var recorder: StreamRecorder
  private val handles: MutableList<Pair<NativeSensor, NativeSensorStreamHandle>> = mutableListOf()

  suspend fun start() {
    Log.i(TAG, "starting streamId=$streamId output=$outputPath")
    recorder = StreamRecorder(outputPath, anchorMonotonicNs)
    val params = StreamParams(
      windowStartNs = windowStartNs,
      windowLookbackMs = windowLookbackMs,
      anchorMonotonicNs = anchorMonotonicNs,
      outputPath = outputPath
    )

    val targets = sensorIds.mapNotNull { id -> sensorRegistry.snapshotSensor(id) }

    // 順序: muxer を起動する責任のある sensor (Camera2Sensor) は最後に呼ぶ。
    // 先に CAMM-track を addTrack する IMU sensors を回す → encoder の drain thread が
    // 後から addVideoTrack + muxer.start() を実行する時点で全 track が揃っている状態にする。
    val (muxerStarters, others) = targets.partition { (it as? StreamCapableSensor)?.startsMuxer == true }
    val ordered = others + muxerStarters

    for (sensor in ordered) {
      val handle: NativeSensorStreamHandle = if (sensor is StreamCapableSensor) {
        sensor.startStream(recorder, params)
      } else {
        // stream 非対応の sensor は録画開始時の単発 snapshot のみ
        DefaultSnapshotStreamHandle(sensor, params)
      }
      handles.add(sensor to handle)
    }
    // muxer.start() は VideoEncoder drain thread が format change 時に行う (StreamSession 側では呼ばない)
  }

  suspend fun stop(): List<SensorResult> {
    Log.i(TAG, "stopping streamId=$streamId")
    val results = mutableListOf<SensorResult>()
    for ((_, handle) in handles) {
      try {
        results.add(handle.stop())
      } catch (t: Throwable) {
        Log.w(TAG, "sensor stop failed: ${t.message}", t)
      }
    }
    recorder.close()
    return results
  }

  suspend fun abort() {
    Log.i(TAG, "aborting streamId=$streamId")
    for ((_, handle) in handles) {
      try { handle.abort() } catch (_: Throwable) {}
    }
    if (::recorder.isInitialized) {
      recorder.close()
      recorder.deleteOutput()
    }
  }
}

/**
 * StreamCapableSensor を実装していない sensor の fallback。
 * 録画開始時に 1 回 capture() を呼んでその結果を保持し、stop() で返す。
 * (例: DeviceInfoSensor のような snapshot-only sensor)
 */
private class DefaultSnapshotStreamHandle(
  private val sensor: NativeSensor,
  private val params: StreamParams
) : NativeSensorStreamHandle {
  private var captured: SensorResult? = null

  init {
    // 起動直後の同期キャプチャは省略。stop で行う (空 window で問題なし)
  }

  override suspend fun stop(): SensorResult {
    // 静止画の単発 capture と同じ window で 1 回取る
    val window = SensorTimeWindow(
      startNs = params.windowStartNs,
      durationMs = 0,
      lookbackMs = 0,
      anchorMonotonicNs = params.anchorMonotonicNs
    )
    captured = sensor.capture(window)
    return captured!!
  }

  override suspend fun abort() {
    captured = null
  }
}
