package io.rootlens.handpose

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.util.Log
import android.view.ViewGroup
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView

/**
 * HandPose ExpoView (Android)。
 *
 * 責務:
 *   - PreviewView を hosting し、CameraX 設定は HandPoseCameraController に委譲
 *   - frameConsumer 経由で受け取った Bitmap を HandPoseDetector に流す
 *   - 検出結果を onHandPose event で emit
 *
 * Lifecycle:
 *   - View 自体が LifecycleOwner として CameraX の bindToLifecycle に渡される。
 *     onAttachedToWindow → STARTED, onDetachedFromWindow → DESTROYED
 *   - 録画中の view detach は controller 側で stop される (sandbox では発生しない想定)
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
    HandPoseCameraController.setFrameConsumer { bitmap, _ -> onFrame(bitmap) }
    HandPoseCameraController.bind(this, context, previewView.surfaceProvider)
  }

  override fun onDetachedFromWindow() {
    HandPoseCameraController.setFrameConsumer(null)
    HandPoseCameraController.unbind()
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

  /**
   * Controller から流れる rotated ARGB_8888 bitmap を MediaPipe HandLandmarker に投入し、
   * 検出結果を onHandPose event で emit。
   */
  private fun onFrame(bitmap: android.graphics.Bitmap) {
    if (paused || detector == null) return

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

  companion object {
    private const val TAG = "HandPosePreviewView"
  }
}
