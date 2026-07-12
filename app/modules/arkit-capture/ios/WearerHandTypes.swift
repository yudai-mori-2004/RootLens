import Foundation

// Types used to classify the wearer's hands.
//
// Coordinates are all normalized [0,1] with a top-left origin. (The conversion
// from Vision's bottom-left origin happens inside HandTracker.)

/// One of the 21 hand landmarks.
struct HLandmark {
  let x: Float
  let y: Float
  let confidence: Float
}

/// Raw data for one hand detected in one frame.
struct RawHand {
  let handedness: String      // "left" | "right" | "unknown"
  let confidence: Float        // confidence of the whole observation
  let landmarks: [HLandmark]   // 21 joints
}

/// MediaPipe-order indices of the 21 joints.
enum HandJoint {
  static let wrist     = 0
  static let thumbCmc  = 1
  static let thumbMcp  = 2
  static let thumbIp   = 3
  static let thumbTip  = 4
  static let indexMcp  = 5
  static let indexPip  = 6
  static let indexDip  = 7
  static let indexTip  = 8
  static let middleMcp = 9
  static let middlePip = 10
  static let middleDip = 11
  static let middleTip = 12
  static let ringMcp   = 13
  static let ringPip   = 14
  static let ringDip   = 15
  static let ringTip   = 16
  static let pinkyMcp  = 17
  static let pinkyPip  = 18
  static let pinkyDip  = 19
  static let pinkyTip  = 20
}

/// One body-pose joint position. Below-threshold confidence is treated as out of frame.
struct BodyPoint {
  let x: Float
  let y: Float
  let confidence: Float
}

/// One body-pose observation. Carries only the joints the wearer test needs
/// (shoulders, elbows, wrists, knees, ankles).
struct RawBody {
  let confidence: Float
  let leftShoulder:  BodyPoint?
  let rightShoulder: BodyPoint?
  let leftElbow:     BodyPoint?
  let rightElbow:    BodyPoint?
  let leftWrist:     BodyPoint?     // most important: points straight at another person's hand
  let rightWrist:    BodyPoint?
  let leftKnee:      BodyPoint?
  let rightKnee:     BodyPoint?
  let leftAnkle:     BodyPoint?
  let rightAnkle:    BodyPoint?
}

/// Classification result, one per hand.
struct ClassifiedHand {
  let raw: RawHand
  let isWearer: Bool        // whether this is the wearer's own hand (drives UI and sound cues)
  let isFootMisdetect: Bool // too close to an ankle: a foot misdetected as a hand
}

/// Hand gestures.
enum HandGesture: String {
  case openPalm  = "open_palm"
  case thumbsUp  = "thumbs_up"
}

/// Final single-frame result handed to the UI layer.
struct FrameClassification {
  let hands: [ClassifiedHand]
  let wearerHandCount: Int     // 0, 1, or 2 (only the wearer's hands count)
  // Aggregating per-hand gestures into a frame-level gesture happens on the TS side.
}
