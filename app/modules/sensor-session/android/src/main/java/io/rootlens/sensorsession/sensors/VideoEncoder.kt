package io.rootlens.sensorsession.sensors

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.util.Log
import android.view.Surface
import io.rootlens.sensorsession.stream.StreamRecorder
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Camera2 → MediaCodec H.264 encoder → StreamRecorder の video track。
 * encoder.createInputSurface() を Camera2 capture session の出力 Surface として使い、
 * encoded frame を drain thread で StreamRecorder.writeVideoSample に流す。
 *
 * 設計:
 *  - MIME = "video/avc" (H.264)
 *  - Color format = COLOR_FormatSurface (encoder input は Surface 経由)
 *  - INFO_OUTPUT_FORMAT_CHANGED 受信時に MediaMuxer の video track を addTrack + start
 *  - signalEndOfInputStream() で stop シグナル → drain thread が END_OF_STREAM frame まで処理して終了
 */
class VideoEncoder(
  width: Int,
  height: Int,
  frameRate: Int,
  bitrate: Int,
  iFrameIntervalSec: Int,
  private val recorder: StreamRecorder
) {
  companion object {
    private const val TAG = "VideoEncoder"
    private const val MIME_AVC = "video/avc"
  }

  private val codec: MediaCodec
  val inputSurface: Surface
  private var drainThread: Thread? = null
  private val stopRequested = AtomicBoolean(false)
  private val videoTrackAdded = AtomicBoolean(false)
  val widthValue: Int = width
  val heightValue: Int = height

  init {
    val format = MediaFormat.createVideoFormat(MIME_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, frameRate)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, iFrameIntervalSec)
    }
    codec = MediaCodec.createEncoderByType(MIME_AVC)
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = codec.createInputSurface()
    codec.start()
    Log.i(TAG, "started: ${width}x${height} @ ${frameRate}fps, ${bitrate / 1_000_000}Mbps")
  }

  fun startDrainThread() {
    drainThread = Thread {
      val info = MediaCodec.BufferInfo()
      var endOfStream = false
      while (!endOfStream) {
        val outIdx = try {
          codec.dequeueOutputBuffer(info, 10_000L)
        } catch (t: Throwable) {
          Log.w(TAG, "dequeueOutputBuffer threw: ${t.message}")
          break
        }
        when {
          outIdx == MediaCodec.INFO_TRY_AGAIN_LATER -> {
            // ノンブロッキングで return。stopRequested かつ EOS 未受信ならループ続行。
            // (signalEndOfInputStream 後は EOS frame が必ず来る前提で待つ)
          }
          outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
            if (videoTrackAdded.compareAndSet(false, true)) {
              recorder.addVideoTrack(codec.outputFormat)
              recorder.start()
              Log.i(TAG, "video track added + muxer started")
            } else {
              Log.w(TAG, "INFO_OUTPUT_FORMAT_CHANGED received twice")
            }
          }
          outIdx >= 0 -> {
            val buf = codec.getOutputBuffer(outIdx)
            if (buf != null && info.size > 0 && (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) == 0) {
              buf.position(info.offset)
              buf.limit(info.offset + info.size)
              recorder.writeVideoSample(buf, info)
            }
            try { codec.releaseOutputBuffer(outIdx, false) } catch (_: Throwable) {}
            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
              endOfStream = true
            }
          }
          // outIdx < 0 (other negative codes) → 無視
        }
      }
      try { codec.stop() } catch (_: Throwable) {}
      try { codec.release() } catch (_: Throwable) {}
      try { inputSurface.release() } catch (_: Throwable) {}
      Log.i(TAG, "drain thread exited")
    }.apply { name = "rootlens-video-encoder"; start() }
  }

  /** signalEndOfInputStream → drain thread が EOS frame を受け取って終了する */
  fun stop() {
    if (stopRequested.compareAndSet(false, true)) {
      try { codec.signalEndOfInputStream() } catch (t: Throwable) {
        Log.w(TAG, "signalEndOfInputStream failed: ${t.message}")
      }
      drainThread?.join(2000)
    }
  }
}
