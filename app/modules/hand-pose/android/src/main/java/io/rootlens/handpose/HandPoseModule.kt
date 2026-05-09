package io.rootlens.handpose

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Hand pose ネイティブモジュール (Android / MediaPipe HandLandmarker + CameraX)。
 *
 * 提供:
 *   - View: <HandPosePreviewView /> — CameraX preview + per-frame hand pose detection
 *   - Event: onHandPose — view から detect 結果を emit
 *   - Prop: paused — frame 配信の一時停止
 *   - AsyncFunction: captureSnapshot — 直近 frame を JPEG 化して URI を返す (VLM 開始/終了判定用)
 *   - AsyncFunction: startRecording / stopRecording — VideoCapture 経由で mp4 録画 (collection flow)
 *
 * 設計:
 *   - HandPoseCameraController が singleton。view が consumer を attach し、
 *     module 関数は controller 経由で snapshot / recording を制御する。
 *   - sandbox 検証フェーズなので、capture / streamRecord IF は持たない (sensor-session の役割)。
 */
class HandPoseModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HandPose")

    View(HandPosePreviewView::class) {
      Events("onHandPose")

      Prop("paused") { view: HandPosePreviewView, paused: Boolean ->
        view.setPaused(paused)
      }
    }

    AsyncFunction("captureSnapshot") { promise: Promise ->
      try {
        val ctx = appContext.reactContext
          ?: throw IllegalStateException("react context unavailable")
        val uri = HandPoseCameraController.captureSnapshot(ctx)
        promise.resolve(uri)
      } catch (t: Throwable) {
        promise.reject("HAND_POSE_SNAPSHOT_ERROR", t.message ?: "snapshot failed", t)
      }
    }

    AsyncFunction("startRecording") { outputPath: String, promise: Promise ->
      try {
        val ctx = appContext.reactContext
          ?: throw IllegalStateException("react context unavailable")
        val uri = HandPoseCameraController.startRecording(ctx, outputPath)
        promise.resolve(uri)
      } catch (t: Throwable) {
        promise.reject("HAND_POSE_RECORDING_START_ERROR", t.message ?: "start failed", t)
      }
    }

    AsyncFunction("stopRecording") { promise: Promise ->
      // suspend を Coroutine で待つ。Module は MainScope を勝手に持たないので明示
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val uri = HandPoseCameraController.stopRecording()
          promise.resolve(uri)
        } catch (t: Throwable) {
          promise.reject("HAND_POSE_RECORDING_STOP_ERROR", t.message ?: "stop failed", t)
        }
      }
    }
  }
}
