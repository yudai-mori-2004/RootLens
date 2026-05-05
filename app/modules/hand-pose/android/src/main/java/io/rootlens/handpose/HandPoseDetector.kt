package io.rootlens.handpose

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.framework.image.MPImage
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarker
import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult

/**
 * MediaPipe HandLandmarker の薄ラッパー。
 *
 * RunningMode は IMAGE (synchronous) を使う。理由:
 *   - VIDEO mode は連続 frame の timestamp 単調性を要求し、CameraX の ImageAnalysis から
 *     取れる timestamp は環境依存で扱いが面倒
 *   - LIVE_STREAM mode は callback async になり、本実装の単純な consumer 設計と相性が悪い
 *   - sandbox 検証フェーズの 30fps 程度なら IMAGE mode でも十分高速
 *
 * model: assets/hand_landmarker.task (~7MB float16, Apache 2.0)。
 * MediaPipe は最初の detect 時に GPU/CPU delegate を初期化するため初回 latency がやや高い。
 *
 * close() を必ず呼んで native resource を解放すること。
 */
class HandPoseDetector(context: Context) {
  private val handLandmarker: HandLandmarker

  init {
    val baseOptions = BaseOptions.builder()
      .setModelAssetPath(MODEL_ASSET_PATH)
      .setDelegate(Delegate.CPU)  // GPU は端末依存 (Adreno で稀に init 失敗)。安定優先で CPU
      .build()

    val options = HandLandmarker.HandLandmarkerOptions.builder()
      .setBaseOptions(baseOptions)
      .setNumHands(MAX_HANDS)
      .setMinHandDetectionConfidence(0.5f)
      .setMinHandPresenceConfidence(0.5f)
      .setMinTrackingConfidence(0.5f)
      .setRunningMode(RunningMode.IMAGE)
      .build()

    handLandmarker = HandLandmarker.createFromOptions(context, options)
  }

  /**
   * Bitmap を 1 フレーム検出。MediaPipe は ARGB_8888 の Bitmap を要求する。
   * @param bitmap カメラ frame を ARGB_8888 で起こしたもの
   * @return 検出された手の一覧 (空なら未検出)
   */
  fun detect(bitmap: Bitmap): List<HandObservation> {
    val mpImage: MPImage = BitmapImageBuilder(bitmap).build()
    val result: HandLandmarkerResult = handLandmarker.detect(mpImage)
    return convert(result)
  }

  fun close() {
    handLandmarker.close()
  }

  /**
   * HandLandmarkerResult → HandObservation[]。
   * MediaPipe の landmarks() は normalized (0..1) で top-left origin。
   * handednesses() は MediaPipe 側 mirror 規約: 「Selfie 撮影視点での right/left」に注意。
   * 実 carrying-hand とは反転している場合があるが、JS-side の gesture 判定はこれで一貫する。
   */
  private fun convert(result: HandLandmarkerResult): List<HandObservation> {
    val out = mutableListOf<HandObservation>()
    val hands = result.landmarks()
    val worldLandmarks = result.worldLandmarks()  // 使わないが API 上参照
    val handedness = result.handedness()

    for (i in hands.indices) {
      val frameLandmarks = hands[i]   // 21 NormalizedLandmark
      val landmarks = ArrayList<HandLandmark>(21)
      for (lm in frameLandmarks) {
        landmarks.add(
          HandLandmark(
            x = lm.x(),
            y = lm.y(),
            z = lm.z(),
            confidence = if (lm.visibility().isPresent) lm.visibility().get() else 1.0f
          )
        )
      }
      // 21 に満たない場合は 0 padding (MediaPipe は通常 21 返すが防御的に)
      while (landmarks.size < 21) {
        landmarks.add(HandLandmark(0f, 0f, 0f, 0f))
      }
      // 21 を超える場合は切り詰め
      val trimmed = if (landmarks.size > 21) landmarks.subList(0, 21).toList() else landmarks

      val handLabel: String
      val score: Float
      if (i < handedness.size && handedness[i].isNotEmpty()) {
        val top = handedness[i][0]
        handLabel = top.categoryName().lowercase()  // "Left" / "Right" → "left" / "right"
        score = top.score()
      } else {
        handLabel = "unknown"
        score = 0f
      }

      out.add(HandObservation(handedness = handLabel, score = score, landmarks = trimmed))
    }
    return out
  }

  companion object {
    private const val MODEL_ASSET_PATH = "hand_landmarker.task"
    private const val MAX_HANDS = 2
  }
}
