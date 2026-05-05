package io.rootlens.handpose

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.ViewGroup
import androidx.camera.core.AspectRatio
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors

/**
 * HandPose ExpoView (Android)。
 *
 * 責務:
 *   - CameraX で back wide-angle camera をプレビュー (PreviewView ベース)
 *   - ImageAnalysis use case で frame を取得し、HandPoseDetector に流す
 *   - 検出結果を onHandPose event で emit
 *
 * Lifecycle:
 *   - View 自体が LifecycleOwner として CameraX に bind する。
 *     Activity の Fragment lifecycle に乗せるより、view の attach/detach に直接合わせる方が
 *     React Native の re-mount サイクルと整合する。
 *   - onAttachedToWindow → STARTED, onDetachedFromWindow → DESTROYED
 *
 * Backpressure:
 *   - ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST で詰まった frame は捨てる
 *   - ImageProxy は detect 完了後に必ず close すること (CameraX 仕様)
 */
@SuppressLint("ViewConstructor")
class HandPosePreviewView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext), LifecycleOwner {

  // EventDispatcher は Expo Module の View Events("onHandPose") で受ける
  val onHandPose by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    layoutParams = ViewGroup.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT
    )
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }

  private val analysisExecutor = Executors.newSingleThreadExecutor()
  private val lifecycleRegistry = LifecycleRegistry(this)
  override val lifecycle get() = lifecycleRegistry

  private var detector: HandPoseDetector? = null
  private var paused: Boolean = false

  init {
    addView(previewView)
    lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.CREATED
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.STARTED
    setupDetector()
    bindCamera()
  }

  override fun onDetachedFromWindow() {
    lifecycleRegistry.currentState = androidx.lifecycle.Lifecycle.State.DESTROYED
    detector?.close()
    detector = null
    super.onDetachedFromWindow()
  }

  fun setPaused(paused: Boolean) {
    this.paused = paused
  }

  private fun setupDetector() {
    if (detector != null) return
    try {
      detector = HandPoseDetector(context.applicationContext)
    } catch (t: Throwable) {
      Log.e(TAG, "HandPoseDetector init failed", t)
    }
  }

  private fun bindCamera() {
    val providerFuture = ProcessCameraProvider.getInstance(context.applicationContext)
    providerFuture.addListener({
      try {
        val provider = providerFuture.get()
        val preview = Preview.Builder().build().also {
          it.surfaceProvider = previewView.surfaceProvider
        }

        // 解析サイズは 720x1280 程度が hand pose 用に十分かつ高速。
        val resolutionSelector = ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(
              Size(720, 1280),
              ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER
            )
          )
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
          .build()

        val analysis = ImageAnalysis.Builder()
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setResolutionSelector(resolutionSelector)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()

        analysis.setAnalyzer(analysisExecutor) { image -> onFrame(image) }

        provider.unbindAll()
        provider.bindToLifecycle(
          this,
          CameraSelector.DEFAULT_BACK_CAMERA,
          preview,
          analysis
        )
      } catch (t: Throwable) {
        Log.e(TAG, "bindCamera failed", t)
      }
    }, androidx.core.content.ContextCompat.getMainExecutor(context))
  }

  /**
   * ImageAnalysis frame consumer。
   * RGBA_8888 → ARGB_8888 Bitmap に変換 (MediaPipe は ARGB_8888 を要求)。
   * imageInfo.rotationDegrees ぶん回転して MediaPipe に渡す。
   * detect 完了後に必ず image.close() する。
   */
  private fun onFrame(image: ImageProxy) {
    if (paused || detector == null) {
      image.close()
      return
    }
    val bitmap: Bitmap? = try {
      val rotated = imageProxyToRotatedArgbBitmap(image)
      rotated
    } catch (t: Throwable) {
      Log.e(TAG, "image conversion failed", t)
      null
    } finally {
      image.close()
    }
    if (bitmap == null) return

    val tsNs = SystemClock.elapsedRealtimeNanos()
    val width = bitmap.width
    val height = bitmap.height
    val hands: List<HandObservation> = try {
      detector?.detect(bitmap) ?: emptyList()
    } catch (t: Throwable) {
      Log.e(TAG, "detect failed", t)
      emptyList()
    }

    val frame = HandPoseFrame(
      timestampNs = tsNs,
      imageWidth = width,
      imageHeight = height,
      hands = hands
    )
    onHandPose(frame.toMap())
  }

  /**
   * ImageProxy (RGBA_8888 / 1 plane) を rotation 適用済み ARGB_8888 Bitmap に変換。
   * CameraX の OUTPUT_IMAGE_FORMAT_RGBA_8888 は実体 ARGB_8888 で 1 plane 連続バッファ。
   */
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
      Bitmap.createBitmap(srcBitmap, 0, 0, image.width, image.height)
    } else srcBitmap

    val rotation = image.imageInfo.rotationDegrees
    val rotated: Bitmap = if (rotation != 0) {
      val matrix = Matrix().apply { postRotate(rotation.toFloat()) }
      Bitmap.createBitmap(cropped, 0, 0, cropped.width, cropped.height, matrix, true)
    } else cropped

    return rotated
  }

  companion object {
    private const val TAG = "HandPosePreviewView"
  }
}
