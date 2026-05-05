import Foundation
import Vision

// MARK: - Hand pose schema (iOS / Android 共通の TS-side schema と一致させる)
//
// 21 landmark の index 規約は MediaPipe HandLandmarker に揃える。
// iOS Vision の VNHumanHandPoseObservation.JointName 群を MediaPipe index にマップする。
//
//  0: WRIST
//  1: THUMB_CMC          2: THUMB_MCP          3: THUMB_IP           4: THUMB_TIP
//  5: INDEX_MCP          6: INDEX_PIP          7: INDEX_DIP          8: INDEX_TIP
//  9: MIDDLE_MCP        10: MIDDLE_PIP        11: MIDDLE_DIP        12: MIDDLE_TIP
// 13: RING_MCP          14: RING_PIP          15: RING_DIP          16: RING_TIP
// 17: PINKY_MCP         18: PINKY_PIP         19: PINKY_DIP         20: PINKY_TIP

struct HandLandmark {
  let x: Float       // normalized [0,1], image top-left origin (Y-flipped from Vision native)
  let y: Float       // normalized [0,1]
  let z: Float       // iOS Vision は 2D のみのため 0 固定 (Android MediaPipe は wrist-relative depth)
  let confidence: Float  // 0..1
}

struct HandObservation {
  let handedness: String   // "left" | "right" | "unknown"
  let score: Float          // overall hand confidence
  let landmarks: [HandLandmark]   // 必ず 21 要素 (取れない joint は confidence=0 で填める)
}

struct HandPoseFrame {
  let timestampNs: UInt64       // mach_absolute_time 由来 monotonic ns
  let imageWidth: Int           // 解析画像のピクセル幅
  let imageHeight: Int          // 解析画像のピクセル高さ
  let hands: [HandObservation]
}

extension HandLandmark {
  func toJSON() -> [String: Any] {
    [
      "x": x,
      "y": y,
      "z": z,
      "confidence": confidence
    ]
  }
}

extension HandObservation {
  func toJSON() -> [String: Any] {
    [
      "handedness": handedness,
      "score": score,
      "landmarks": landmarks.map { $0.toJSON() }
    ]
  }
}

extension HandPoseFrame {
  func toJSON() -> [String: Any] {
    [
      "timestamp_ns": String(timestampNs),
      "image_width": imageWidth,
      "image_height": imageHeight,
      "hands": hands.map { $0.toJSON() }
    ]
  }
}

// MARK: - Vision joint → MediaPipe index map

enum HandPoseJointMap {
  /// Vision JointName → MediaPipe 21-joint index。
  /// Vision の jointsGroupName(.thumb) などで取得した joint dictionary をこの順で並べ直す。
  static let visionToMediaPipeIndex: [VNHumanHandPoseObservation.JointName: Int] = [
    .wrist: 0,
    .thumbCMC: 1, .thumbMP: 2, .thumbIP: 3, .thumbTip: 4,
    .indexMCP: 5, .indexPIP: 6, .indexDIP: 7, .indexTip: 8,
    .middleMCP: 9, .middlePIP: 10, .middleDIP: 11, .middleTip: 12,
    .ringMCP: 13, .ringPIP: 14, .ringDIP: 15, .ringTip: 16,
    .littleMCP: 17, .littlePIP: 18, .littleDIP: 19, .littleTip: 20
  ]
}
