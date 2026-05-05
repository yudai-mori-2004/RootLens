package io.rootlens.handpose

// Hand pose schema (iOS / Android 共通の TS-side schema と一致させる)。
//
// 21 landmark の index 規約は MediaPipe HandLandmarker の native 順そのまま使う。
//  0: WRIST
//  1-4: THUMB (CMC, MCP, IP, TIP)
//  5-8: INDEX (MCP, PIP, DIP, TIP)
//  9-12: MIDDLE
// 13-16: RING
// 17-20: PINKY

/**
 * @param x normalized [0,1], image top-left origin
 * @param y normalized [0,1]
 * @param z wrist-relative depth (MediaPipe 出力の z; 単位は wrist 座標系の相対値で正確なメートルではない)
 * @param confidence presence/visibility 0..1
 */
data class HandLandmark(
  val x: Float,
  val y: Float,
  val z: Float,
  val confidence: Float
) {
  fun toMap(): Map<String, Any> = mapOf(
    "x" to x,
    "y" to y,
    "z" to z,
    "confidence" to confidence
  )
}

/**
 * @param handedness "left" | "right" | "unknown"
 * @param score overall hand confidence (HandLandmarkerResult.handednesses() top category score)
 */
data class HandObservation(
  val handedness: String,
  val score: Float,
  val landmarks: List<HandLandmark>   // 必ず 21 要素
) {
  fun toMap(): Map<String, Any> = mapOf(
    "handedness" to handedness,
    "score" to score,
    "landmarks" to landmarks.map { it.toMap() }
  )
}

/**
 * Per-frame detection result.
 */
data class HandPoseFrame(
  val timestampNs: Long,
  val imageWidth: Int,
  val imageHeight: Int,
  val hands: List<HandObservation>
) {
  fun toMap(): Map<String, Any> = mapOf(
    "timestamp_ns" to timestampNs.toULong().toString(),
    "image_width" to imageWidth,
    "image_height" to imageHeight,
    "hands" to hands.map { it.toMap() }
  )
}
