package io.rootlens.sensorsession.stream

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.util.Log
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * 動画 stream の出力 mp4 を 1 つ持ち、video track + CAMM track を addTrack して書き出す。
 * Camera2Sensor が encoded video frame を渡し、SensorEventSensor が CAMM binary samples を渡す。
 *
 * Phase 2 で video track 書き出し、Phase 3 で CAMM track 書き出しを実装する。
 * 本ファイルは StreamSession から呼ばれる出力面の API のみを定義する。
 *
 * 設計:
 *  - track add は muxer.start() の前にすべて済ませる必要がある
 *  - addVideoTrack / addCammTrack を呼んだ後で start() を呼ぶ
 *  - PTS は anchorMonotonicNs を 0 とする相対 us で書く (Camera2 SENSOR_TIMESTAMP / SensorEvent.timestamp と整合)
 */
class StreamRecorder(
  val outputPath: String,
  /** 録画開始 monotonic ns。各 sample の PTS = (sampleTimestampNs - anchorMonotonicNs) / 1000 */
  val anchorMonotonicNs: Long
) {
  companion object {
    private const val TAG = "StreamRecorder"
    /** CAMM track の MIME type (Google CAMM spec) */
    const val MIME_CAMM = "application/camm"
  }

  private val muxer: MediaMuxer = MediaMuxer(outputPath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private var videoTrackIndex: Int = -1
  private var cammTrackIndex: Int = -1
  private val started = AtomicBoolean(false)
  private val stopped = AtomicBoolean(false)
  private val muxerLock = Any()
  // CAMM track 用の単調増加 PTS guard。MediaMuxer は per-track で PTS が単調増加でないと SIGABRT する。
  // 複数 sensor (accel / gyro / mag) が同一 CAMM track に書き込むため衝突する可能性が高い。
  private val lastCammPtsUs = AtomicLong(-1L)
  // video track の最初のサンプル PTS (us)。MediaMuxer は track 内の PTS が 0 から始まる前提のため、
  // 全 frame からこれを subtract して相対 PTS にする。
  // encoder 出力の PTS は CLOCK_MONOTONIC 由来 (Surface BufferQueue の systemTime) で、
  // anchorMonotonicNs (= elapsedRealtimeNanos = CLOCK_BOOTTIME) と時間軸が違うので
  // 単純に anchor を引いてはいけない (Pixel 10 で 44h sleep していると 7.5x ずれる)。
  private val firstVideoPtsUs = AtomicLong(-1L)
  private val videoWriteCount = AtomicLong(0)
  private val cammWriteCount = AtomicLong(0)
  private val cammDropCount = AtomicLong(0)

  /** Camera2 / MediaCodec の最初の output format を渡して video track を追加する (start 前に呼ぶ) */
  fun addVideoTrack(format: MediaFormat): Int = synchronized(muxerLock) {
    if (started.get()) error("addVideoTrack must be called before start()")
    if (videoTrackIndex >= 0) error("video track already added")
    videoTrackIndex = muxer.addTrack(format)
    Log.i(TAG, "video track added: idx=$videoTrackIndex format=$format")
    videoTrackIndex
  }

  // CAMM track 追加 (v0.1.1 では no-op)
  //
  // v0.1.1 の設計判断: AOSP MediaMuxer は application MIME track を TextMetaDataSampleEntry (mett)
  // として扱い、binary CAMM サンプルの writeSampleData が拒否される (内部は text 想定)。
  // CAMM 仕様準拠の "camm" SampleEntry を持つ mp4 を吐くには mp4parser 等で post-process するか
  // 自前 mp4 muxer が必要。v0.1.1 では IMU データを C2PA assertion inline JSON (ring buffer slice)
  // で保存する経路 (静止画と同様) で十分なので、CAMM track 書き出しは v0.1.2 以降に延期する。
  //
  // 戻り値 -1: track 未作成 (writeCammVec3 は silent no-op になる)
  fun addCammTrack(): Int = synchronized(muxerLock) {
    if (started.get()) return@synchronized -1
    if (cammTrackIndex >= 0) return@synchronized cammTrackIndex
    Log.i(TAG, "CAMM track skipped (v0.1.1: IMU stored as inline JSON; CAMM track deferred)")
    -1
  }

  /** 全 track を addTrack した後に呼ぶ。muxer.start() が throw したら started フラグは立てない */
  fun start() = synchronized(muxerLock) {
    if (started.get()) return@synchronized
    muxer.start()
    started.set(true)
    Log.i(TAG, "muxer started: output=$outputPath")
  }

  fun isStarted(): Boolean = started.get()

  /**
   * Camera2 / MediaCodec から encoded video frame を書き出す。
   * encoder の info.presentationTimeUs は Camera2 SENSOR_TIMESTAMP 由来の絶対 us。
   * MediaMuxer は track 内の最初の PTS が 0 から始まることを期待するので、
   * anchorMonotonicNs を 0 とする相対 us に補正する。
   */
  fun writeVideoSample(buffer: ByteBuffer, info: MediaCodec.BufferInfo) {
    if (!started.get() || stopped.get() || videoTrackIndex < 0) return
    // 最初のフレームの PTS を 0 とする相対値に変換
    firstVideoPtsUs.compareAndSet(-1L, info.presentationTimeUs)
    val rel = (info.presentationTimeUs - firstVideoPtsUs.get()).coerceAtLeast(0L)
    val cnt = videoWriteCount.get()
    if (cnt < 3 || cnt == 50L || cnt == 100L) {
      Log.i(TAG, "video sample[$cnt]: raw_pts=${info.presentationTimeUs} first=${firstVideoPtsUs.get()} rel=$rel size=${info.size} flags=${info.flags}")
    }
    val adjusted = MediaCodec.BufferInfo().apply {
      set(info.offset, info.size, rel, info.flags)
    }
    synchronized(muxerLock) {
      if (stopped.get()) return@synchronized
      try {
        muxer.writeSampleData(videoTrackIndex, buffer, adjusted)
        videoWriteCount.incrementAndGet()
      } catch (t: Throwable) {
        Log.w(TAG, "writeVideoSample dropped: ${t.message}")
      }
    }
  }

  // ---------------- CAMM サンプル書き出し (Phase 3) ----------------

  /** CAMM type=2 (gyro [rad/s]) / 3 (accel [m/s²]) / 7 (magnetic [μT]) の 3 軸 vec を書き出す。
   *  binary layout: [reserved(2B) | type(2B) | x(4B float) | y(4B float) | z(4B float)] little-endian, 16 bytes
   *
   *  CAMM track は複数 sensor (accel/gyro/mag) が共有するため、PTS は OOO で来うる。
   *  MediaMuxer は per-track で PTS が単調増加でないと native crash するため、ここで monotonic clamp する。
   */
  fun writeCammVec3(type: Int, x: Float, y: Float, z: Float, timestampNs: Long) {
    if (!started.get() || stopped.get() || cammTrackIndex < 0) return
    val anchorUs = anchorMonotonicNs / 1000L
    val baseRel = ((timestampNs - anchorUs * 1000L) / 1000L).coerceAtLeast(0L)
    // 単調増加 PTS を保証 (CAS で last+1 にクランプ)
    var pts = 0L
    while (true) {
      val last = lastCammPtsUs.get()
      val candidate = if (baseRel <= last) last + 1L else baseRel
      if (lastCammPtsUs.compareAndSet(last, candidate)) {
        pts = candidate
        break
      }
    }
    val payload = ByteBuffer.allocate(16).order(ByteOrder.LITTLE_ENDIAN).apply {
      putShort(0)                  // reserved
      putShort(type.toShort())
      putFloat(x); putFloat(y); putFloat(z)
    }
    payload.flip()
    val info = MediaCodec.BufferInfo().apply {
      offset = 0; size = payload.remaining()
      presentationTimeUs = pts
      flags = 0
    }
    synchronized(muxerLock) {
      if (stopped.get()) return@synchronized
      try {
        muxer.writeSampleData(cammTrackIndex, payload, info)
        cammWriteCount.incrementAndGet()
      } catch (t: Throwable) {
        cammDropCount.incrementAndGet()
        if (cammDropCount.get() < 5) {
          Log.w(TAG, "writeCammVec3 dropped (type=$type pts=$pts): ${t.message}")
        }
      }
    }
  }

  /** CAMM type=4 (position 6DoF: angle-axis 3 + position 3 + 1 reserved) も将来拡張可。Phase 3 では未使用 */

  /** Muxer を閉じる (mp4 finalize)。複数回呼ばれても 1 度だけ実行 */
  fun close() {
    if (stopped.compareAndSet(false, true)) {
      synchronized(muxerLock) {
        try {
          if (started.get()) muxer.stop()
        } catch (t: Throwable) { Log.w(TAG, "muxer.stop failed: ${t.message}") }
        try { muxer.release() } catch (t: Throwable) { Log.w(TAG, "muxer.release failed: ${t.message}") }
      }
      Log.i(TAG, "muxer closed: output=$outputPath, video=${videoWriteCount.get()}, camm=${cammWriteCount.get()}, camm_dropped=${cammDropCount.get()}")
    }
  }

  /** 出力ファイルを削除 (abort 用) */
  fun deleteOutput() {
    try { File(outputPath).delete() } catch (_: Throwable) {}
  }
}
