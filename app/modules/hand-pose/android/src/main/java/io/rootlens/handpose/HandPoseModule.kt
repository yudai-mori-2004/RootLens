package io.rootlens.handpose

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Hand pose ネイティブモジュール (Android / MediaPipe HandLandmarker)。
 *
 * 提供:
 *   - View: <HandPosePreviewView /> — CameraX preview + per-frame hand pose detection
 *   - Event: onHandPose — view から detect 結果を emit
 *   - Prop: paused — frame 配信の一時停止
 *
 * 設計:
 *   - View に閉じ込め、Module 関数は最小限。frame stream は view が own。
 *   - sandbox 検証フェーズなので、sensor-session のような capture / streamRecord IF は持たない。
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
  }
}
