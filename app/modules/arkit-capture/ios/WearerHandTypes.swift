import Foundation

// 装着者の手の分類に使う型群。
//
// 座標系: すべて normalized [0,1]、 left-top 原点。
// (Vision API の左下原点からの変換は HandTracker / BodyPoseDetector 内で行う)

/// 21 関節の手のランドマーク 1 個分。
struct HLandmark {
  let x: Float
  let y: Float
  let confidence: Float
}

/// 1 フレームで検出された手 1 つ分の生データ。
struct RawHand {
  let handedness: String      // "left" | "right" | "unknown"
  let confidence: Float        // 観察全体の信頼度
  let landmarks: [HLandmark]   // 21 関節
}

/// 21 関節の MediaPipe 順インデックス。
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

/// 身体ポーズで使う関節 1 個分の位置。 confidence < しきい値なら inFrame=false 扱い。
struct BodyPoint {
  let x: Float
  let y: Float
  let confidence: Float
}

/// 身体ポーズの 1 観察分。 装着者判定で使うフィールドだけ持つ (= 肩・肘・手首・足首・膝)。
struct RawBody {
  let confidence: Float
  let leftShoulder:  BodyPoint?
  let rightShoulder: BodyPoint?
  let leftElbow:     BodyPoint?
  let rightElbow:    BodyPoint?
  let leftWrist:     BodyPoint?     // 他人物の手の位置を直接示すので最重要
  let rightWrist:    BodyPoint?
  let leftKnee:      BodyPoint?
  let rightKnee:     BodyPoint?
  let leftAnkle:     BodyPoint?
  let rightAnkle:    BodyPoint?
}

/// 分類結果。 1 つの手につき 1 個。
struct ClassifiedHand {
  let raw: RawHand
  let isWearer: Bool       // 装着者本人の手か (= true なら UI 表示・効果音判定の対象)
  let isFootMisdetect: Bool // 足首位置と近すぎる = 足の誤検出
}

/// 手のサイン。
enum HandGesture: String {
  case openPalm  = "open_palm"
  case thumbsUp  = "thumbs_up"
}

/// 1 フレーム分の最終結果 (= UI に出す前の単一フレーム判定)。
struct FrameClassification {
  let hands: [ClassifiedHand]
  let wearerHandCount: Int     // = 0, 1, 2 (本人の手だけ数える)
  let gesture: HandGesture?    // 装着者の両手が同じサインを 1 フレームで示しているとき
}
