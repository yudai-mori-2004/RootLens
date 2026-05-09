package io.rootlens.handpose

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.util.Log
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.CompletableDeferred
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Hand pose の AVCaptureSession 同等品 (Android / CameraX) を own する singleton。
 *
 * iOS の HandPoseCameraController.shared と同役割:
 *   - Preview / ImageAnalysis / VideoCapture の 3 use case を 1 つの bind で持つ
 *   - View からは preview SurfaceProvider と frame consumer を attach させる
 *   - Module 関数 (captureSnapshot / startRecording / stopRecording) は controller を呼ぶ
 *
 * これにより view re-mount の影響を受けずに recording state を保持できる。
 */
@SuppressLint("RestrictedApi")
object HandPoseCameraController {
  private const val TAG = "HandPoseCameraCtrl"

  // CameraX provider + use cases。bind 時に生成、unbind 時に破棄
  private var provider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var videoCapture: VideoCapture<Recorder>? = null
  private var boundLifecycleOwner: LifecycleOwner? = null

  // Frame consumer (view が detect/emit に使う)。null なら frame は捨てる
  private var frameConsumer: ((Bitmap, Int) -> Unit)? = null

  // 直近 ImageAnalysis frame の rotated ARGB Bitmap (snapshot 用)。AtomicReference で
  // 解析スレッド ↔ snapshot 呼び出しスレッド (Module の AsyncFunction) 間を安全に渡す
  private val latestSnapshotBitmap = AtomicReference<Bitmap?>(null)

  // Recording state
  private var recording: Recording? = null
  private var recordingDoneSignal: CompletableDeferred<String>? = null
  private var pendingOutputPath: String? = null

  private val analysisExecutor = Executors.newSingleThreadExecutor()
  private val videoExecutor = Executors.newSingleThreadExecutor()

  /** View 側から呼ばれる: CameraX を view の lifecycle に bind */
  @Synchronized
  fun bind(lifecycleOwner: LifecycleOwner, context: Context, surfaceProvider: Preview.SurfaceProvider) {
    if (boundLifecycleOwner === lifecycleOwner && provider != null) {
      // 既に bind 済み (view が再 attach されたケース。surfaceProvider だけ差し替え)
      preview?.surfaceProvider = surfaceProvider
      return
    }
    val ctx = context.applicationContext
    val providerFuture = ProcessCameraProvider.getInstance(ctx)
    providerFuture.addListener({
      try {
        val cp = providerFuture.get()
        cp.unbindAll()

        val previewUseCase = Preview.Builder().build().also {
          it.surfaceProvider = surfaceProvider
        }

        // Analysis: 720x1280 程度で hand pose 用に十分かつ高速
        val resolutionSelector = ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(
              Size(720, 1280),
              ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER
            )
          )
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
          .build()

        val analysisUseCase = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setResolutionSelector(resolutionSelector)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()

        analysisUseCase.setAnalyzer(analysisExecutor) { image -> onFrame(image) }

        // Video: 1080p 無音録画。HwVideoEncoder 内部で processing も行う
        val recorder = Recorder.Builder()
          .setQualitySelector(
            QualitySelector.fromOrderedList(
              listOf(Quality.FHD, Quality.HD, Quality.SD)
            )
          )
          .setExecutor(videoExecutor)
          .build()
        val videoUseCase = VideoCapture.withOutput(recorder)

        cp.bindToLifecycle(
          lifecycleOwner,
          CameraSelector.DEFAULT_BACK_CAMERA,
          previewUseCase,
          analysisUseCase,
          videoUseCase,
        )

        provider = cp
        preview = previewUseCase
        analysis = analysisUseCase
        videoCapture = videoUseCase
        boundLifecycleOwner = lifecycleOwner
        Log.i(TAG, "bind ok: preview + analysis + video")
      } catch (t: Throwable) {
        Log.e(TAG, "bind failed", t)
      }
    }, ContextCompat.getMainExecutor(ctx))
  }

  /** View 側から呼ばれる: CameraX を unbind して全 use case 解放 */
  @Synchronized
  fun unbind() {
    try {
      // Recording 中なら停止 (file は壊れる可能性あり、本来は finalize 待つべき)
      recording?.stop()
      recording = null
      provider?.unbindAll()
    } catch (t: Throwable) {
      Log.w(TAG, "unbind error: ${t.message}")
    }
    provider = null
    preview = null
    analysis = null
    videoCapture = null
    boundLifecycleOwner = null
    latestSnapshotBitmap.getAndSet(null)?.recycle()
    Log.i(TAG, "unbind done")
  }

  /** View 側から呼ばれる: detect 用 frame consumer を登録 */
  fun setFrameConsumer(consumer: ((Bitmap, Int) -> Unit)?) {
    frameConsumer = consumer
  }

  /**
   * ImageAnalysis frame consumer (analysisExecutor 上で実行)。
   * 1) view 側 frame consumer を呼ぶ (detect → emit)
   * 2) snapshot 用に rotated bitmap を AtomicReference にキャッシュ
   */
  private fun onFrame(image: ImageProxy) {
    val bitmap: Bitmap? = try {
      imageProxyToRotatedArgbBitmap(image)
    } catch (t: Throwable) {
      Log.e(TAG, "image conversion failed", t)
      null
    } finally {
      image.close()
    }
    if (bitmap == null) return

    // view 側 detect → emit
    try {
      frameConsumer?.invoke(bitmap, 0)
    } catch (t: Throwable) {
      Log.e(TAG, "frame consumer threw", t)
    }

    // snapshot キャッシュ更新 (古い bitmap は recycle)
    val old = latestSnapshotBitmap.getAndSet(
      // copy して保持 (view detect が同 bitmap を mutate する可能性に備える)
      bitmap.copy(Bitmap.Config.ARGB_8888, false)
    )
    old?.recycle()
  }

  // ----- Module 関数本体 ----------------------------------------------------

  /** 直近 frame を JPEG (cacheDir) に保存し file:// URI を返す */
  fun captureSnapshot(context: Context, quality: Int = 85): String {
    val bitmap = latestSnapshotBitmap.get()
      ?: throw IllegalStateException("no analysis frame yet — preview not active?")
    val file = File(
      context.cacheDir,
      "rootlens_snapshot_${System.nanoTime()}.jpg"
    )
    FileOutputStream(file).use { out ->
      bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
    }
    return "file://${file.absolutePath}"
  }

  /** mp4 録画開始。outputPath が空なら cacheDir に temp 生成。返値は最終 file:// URI */
  @Synchronized
  fun startRecording(context: Context, outputPath: String): String {
    if (recording != null) throw IllegalStateException("recording already in progress")
    val vc = videoCapture ?: throw IllegalStateException("camera not bound — preview not visible?")

    val outFile = if (outputPath.isBlank()) {
      File(context.cacheDir, "rootlens_video_${System.nanoTime()}.mp4")
    } else {
      File(outputPath.removePrefix("file://"))
    }

    val opts = FileOutputOptions.Builder(outFile).build()
    val signal = CompletableDeferred<String>()
    recordingDoneSignal = signal
    pendingOutputPath = outFile.absolutePath

    recording = vc.output
      .prepareRecording(context, opts)
      .start(videoExecutor) { event ->
        when (event) {
          is VideoRecordEvent.Start -> Log.i(TAG, "recording start: ${outFile.absolutePath}")
          is VideoRecordEvent.Finalize -> {
            val ok = !event.hasError()
            val absPath = pendingOutputPath ?: outFile.absolutePath
            if (ok) {
              Log.i(TAG, "recording finalize ok: $absPath")
              signal.complete("file://$absPath")
            } else {
              Log.w(TAG, "recording finalize error: code=${event.error} cause=${event.cause?.message}")
              signal.completeExceptionally(
                RuntimeException("recording finalize failed: ${event.cause?.message ?: "code=${event.error}"}")
              )
            }
            recording = null
            recordingDoneSignal = null
            pendingOutputPath = null
          }
        }
      }

    return "file://${outFile.absolutePath}"
  }

  /** 録画停止 → finalize 完了を待って file:// URI を返す */
  suspend fun stopRecording(): String {
    val r = recording ?: throw IllegalStateException("no active recording")
    val signal = recordingDoneSignal
      ?: throw IllegalStateException("no done-signal — recording state inconsistent")
    r.stop()
    return signal.await()
  }

  // ----- Image conversion helper (移管: 旧 view と同等処理) ------------------

  private fun imageProxyToRotatedArgbBitmap(image: ImageProxy): Bitmap {
    val plane = image.planes[0]
    val buffer = plane.buffer
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride
    val rowPadding = rowStride - pixelStride * image.width

    val srcWidth = image.width + rowPadding / pixelStride
    val srcBitmap = Bitmap.createBitmap(srcWidth, image.height, Bitmap.Config.ARGB_8888)
    srcBitmap.copyPixelsFromBuffer(buffer)

    val cropped = if (rowPadding > 0) {
      val c = Bitmap.createBitmap(srcBitmap, 0, 0, image.width, image.height)
      srcBitmap.recycle()
      c
    } else srcBitmap

    val rotation = image.imageInfo.rotationDegrees
    return if (rotation != 0) {
      val matrix = android.graphics.Matrix().apply { postRotate(rotation.toFloat()) }
      val rotated = Bitmap.createBitmap(cropped, 0, 0, cropped.width, cropped.height, matrix, true)
      cropped.recycle()
      rotated
    } else cropped
  }
}
