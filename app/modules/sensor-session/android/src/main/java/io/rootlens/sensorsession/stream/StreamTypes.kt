package io.rootlens.sensorsession.stream

import io.rootlens.sensorsession.SensorResult

/**
 * 動画 stream 録画のパラメータ (Task 03)。
 * StreamSession が各 NativeSensor の startStream() に渡す。
 */
data class StreamParams(
  /** wall-clock 開始時刻 (Date.now()*1e6, 表示用) */
  val windowStartNs: Long,
  /** 録画開始前の IMU ルックバック ms (CAMM track には乗らない、assertion inline 用) */
  val windowLookbackMs: Int,
  /** ネイティブ録画開始 monotonic ns (SystemClock.elapsedRealtimeNanos / mach_absolute_time)。
   *  Camera2 SENSOR_TIMESTAMP / SensorEvent.timestamp と同軸 */
  val anchorMonotonicNs: Long,
  /** 録画 mp4 の出力先パス */
  val outputPath: String
)

/**
 * stream 中の sensor を表すハンドル。stop / abort で終了する。
 */
interface NativeSensorStreamHandle {
  /** sensor を flush + 結果を返す。SensorResult.payload に最終情報を入れる */
  suspend fun stop(): SensorResult

  /** 録画放棄 (出力 flush せず破棄) */
  suspend fun abort()
}

/**
 * stream 録画に対応する NativeSensor が実装するオプション interface。
 * 実装しない sensor は StreamSession 側で「初期 snapshot のみ」扱いになる。
 *
 * startsMuxer フラグ: 本 sensor の startStream が「StreamRecorder の muxer を async-start する責任を持つ」
 * 場合は true。Camera2Sensor は VideoEncoder drain thread から format change 時に muxer.start を呼ぶため true。
 * StreamSession は startsMuxer=true の sensor を最後に並べることで、
 * 先に CAMM track 等の他 track が addTrack 済みの状態で muxer 起動できる。
 */
interface StreamCapableSensor {
  val startsMuxer: Boolean get() = false
  suspend fun startStream(recorder: StreamRecorder, params: StreamParams): NativeSensorStreamHandle
}
