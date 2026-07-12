import Foundation

// Pure functions that classify one frame's detections. No state, no side effects.
//
// Classification rules (the body-pose signal is optional; the current caller
// passes nil, which reduces the rules to 3 and 4):
//
//   1. If body pose places another person's wrist, elbow, or shoulder in frame,
//      any hand within 0.18 (18% of image width) of it is excluded as that
//      person's hand.
//
//   2. A hand within 0.06 of a confidently detected ankle or knee is discarded
//      as a foot misdetected as a hand.
//
//   3. Of the remaining hands, at most 2 count as the wearer's, highest
//      confidence first.
//
//   4. Per-hand gestures are attached here; combining them into a frame-level
//      gesture (both hands must agree) happens on the TS side.

enum WearerHandClassifier {

  static let bodyPointConfThreshold: Float = 0.4
  /// Looser wrist-confidence threshold for the occlusion fallback: Vision body
  /// pose reports wrists at fairly low confidence even at the edge of view.
  static let bodyWristConfThresholdForFallback: Float = 0.25
  static let footMisdetectDistance: Float = 0.06
  static let nonWearerHandDistance: Float = 0.18
  static let maxWearerHands: Int = 2
  // Minimum confidence for a hand to count as the wearer's. At 0.5 even a
  // clearly visible hand transiently dips below and flickers out of the UI;
  // 0.3 keeps detection steady.
  static let minHandScoreForWearer: Float = 0.3

  /// Whether a body-pose point is actually inside the frame. Confidence alone
  /// is not enough: Vision hallucinates off-screen joints by extrapolating the
  /// arm, so the normalized [0,1] range check is applied too.
  static func isInFrame(_ p: BodyPoint?, confThreshold: Float) -> Bool {
    guard let p = p else { return false }
    return p.confidence >= confThreshold &&
           p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  }

  static func classify(hands: [RawHand], body: RawBody?) -> FrameClassification {

    // Collect spatial proxies for other people's hands. Body wrists are the most
    // reliable; elbows and shoulders stand in when wrists are missing (coarse,
    // but the goal is just "is someone else in front of the camera").
    var nonWearerPoints: [(x: Float, y: Float)] = []
    if let b = body {
      let highConfBodyParts: [BodyPoint?] = [
        b.leftWrist, b.rightWrist, b.leftElbow, b.rightElbow, b.leftShoulder, b.rightShoulder
      ]
      for p in highConfBodyParts {
        if let pp = p, pp.confidence >= bodyPointConfThreshold {
          nonWearerPoints.append((pp.x, pp.y))
        }
      }
    }

    // Ankle and knee positions, for the foot-misdetection test.
    var footPoints: [(x: Float, y: Float)] = []
    if let b = body {
      for p in [b.leftAnkle, b.rightAnkle, b.leftKnee, b.rightKnee] {
        if let pp = p, pp.confidence >= bodyPointConfThreshold {
          footPoints.append((pp.x, pp.y))
        }
      }
    }

    var classified: [ClassifiedHand] = []
    for hand in hands {
      let wristIdx = HandJoint.wrist
      guard hand.landmarks.count > wristIdx else { continue }

      // Reject hands whose overall confidence is too low (noise suppression).
      if hand.confidence < minHandScoreForWearer {
        classified.append(ClassifiedHand(raw: hand, isWearer: false, isFootMisdetect: false))
        continue
      }

      let wrist = hand.landmarks[wristIdx]
      let hx = wrist.x
      let hy = wrist.y

      // Foot / leg misdetection test.
      var isFoot = false
      for a in footPoints {
        if distXY(hx, hy, a.x, a.y) < footMisdetectDistance {
          isFoot = true
          break
        }
      }
      if isFoot {
        classified.append(ClassifiedHand(raw: hand, isWearer: false, isFootMisdetect: true))
        continue
      }

      // Another person's hand?
      var isOtherPerson = false
      for w in nonWearerPoints {
        if distXY(hx, hy, w.x, w.y) < nonWearerHandDistance {
          isOtherPerson = true
          break
        }
      }
      if isOtherPerson {
        classified.append(ClassifiedHand(raw: hand, isWearer: false, isFootMisdetect: false))
        continue
      }

      classified.append(ClassifiedHand(raw: hand, isWearer: true, isFootMisdetect: false))
    }

    // At most 2 hands count as the wearer's (highest confidence first); accepting
    // more risks pulling in someone else's hands.
    let wearerCandidates = classified.enumerated()
      .filter { $0.element.isWearer }
      .sorted { a, b in a.element.raw.confidence > b.element.raw.confidence }
    let acceptedIndices = Set(wearerCandidates.prefix(maxWearerHands).map { $0.offset })
    var finalClassified: [ClassifiedHand] = []
    for (i, ch) in classified.enumerated() {
      if ch.isWearer && !acceptedIndices.contains(i) {
        finalClassified.append(ClassifiedHand(raw: ch.raw, isWearer: false, isFootMisdetect: false))
      } else {
        finalClassified.append(ch)
      }
    }

    // Occlusion fallback: when hand pose found fewer than 2 hands, fill in from
    // body-pose wrists. The wearer's own shoulders and elbows are never in frame
    // on a head-mounted camera, so if no shoulder/elbow is visible, an in-frame
    // body wrist is taken to be a wearer hand that hand pose lost to occlusion.
    var augmentedClassified = finalClassified
    let currentWearerHands = finalClassified.filter { $0.isWearer }
    if currentWearerHands.count < 2, let b = body {
      let shoulderInFrame = (b.leftShoulder?.confidence ?? 0) >= bodyPointConfThreshold ||
                            (b.rightShoulder?.confidence ?? 0) >= bodyPointConfThreshold
      let elbowInFrame    = (b.leftElbow?.confidence ?? 0) >= bodyPointConfThreshold ||
                            (b.rightElbow?.confidence ?? 0) >= bodyPointConfThreshold
      // The "this body is the wearer" condition: no shoulder or elbow in frame.
      if !shoulderInFrame && !elbowInFrame {
        let bodyWrists: [BodyPoint] = [b.leftWrist, b.rightWrist].compactMap { $0 }
          .filter { p in
            p.confidence >= bodyPointConfThreshold &&
            p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
          }
        for bw in bodyWrists {
          // Add as a synthetic hand only if far enough from every existing wearer hand.
          let alreadyMatched = currentWearerHands.contains { hand in
            let hWrist = hand.raw.landmarks[HandJoint.wrist]
            return distXY(bw.x, bw.y, hWrist.x, hWrist.y) < 0.15
          }
          if !alreadyMatched {
            // Only the wrist is filled in; the other 20 joints stay at confidence 0 (undetected).
            var lms: [HLandmark] = Array(repeating: HLandmark(x: 0, y: 0, confidence: 0), count: 21)
            lms[HandJoint.wrist] = HLandmark(x: bw.x, y: bw.y, confidence: bw.confidence)
            let synthetic = RawHand(handedness: "unknown", confidence: bw.confidence, landmarks: lms)
            augmentedClassified.append(ClassifiedHand(raw: synthetic, isWearer: true, isFootMisdetect: false))
            if augmentedClassified.filter({ $0.isWearer }).count >= maxWearerHands { break }
          }
        }
      }
    }

    // The augmented set is the final result.
    let finalAll = augmentedClassified
    let wearerHands = finalAll.filter { $0.isWearer }
    let wearerCount = wearerHands.count

    // Frame-level gesture aggregation (both-hands agreement, tolerant of single
    // nil frames) lives on the TS side; native only attaches per-hand results,
    // so the aggregation policy can be tuned without a native rebuild.
    return FrameClassification(hands: finalAll, wearerHandCount: wearerCount)
  }

  // MARK: - Gesture detection
  //
  // Shape-based rules built to kill the two failure modes of a downward-looking
  // head-mounted view:
  //   - Typing misread as thumbs_up: never use image-space y; decide from the
  //     compactness of the fist plus the thumb sticking out of it.
  //   - A full open palm going undetected: no 5-finger AND; require a majority
  //     of the fingers whose joints are confidently visible, treating
  //     low-confidence fingers as "unknown" rather than "folded".
  //   - Extension / curl come from joint angles; distances are normalized by
  //     palm width, so the rules are scale-free.
  static func detectGesture(hand: RawHand) -> HandGesture? {
    let lm = hand.landmarks
    guard lm.count >= 21 else { return nil }
    if hand.confidence < 0.5 { return nil }

    let idxMcp = lm[HandJoint.indexMcp]
    let pkyMcp = lm[HandJoint.pinkyMcp]
    guard idxMcp.confidence >= 0.3, pkyMcp.confidence >= 0.3 else { return nil }
    let palmW = dist(idxMcp, pkyMcp)
    guard palmW > 1e-5 else { return nil }

    let fingers: [(mcp: Int, pip: Int, tip: Int)] = [
      (HandJoint.indexMcp,  HandJoint.indexPip,  HandJoint.indexTip),
      (HandJoint.middleMcp, HandJoint.middlePip, HandJoint.middleTip),
      (HandJoint.ringMcp,   HandJoint.ringPip,   HandJoint.ringTip),
      (HandJoint.pinkyMcp,  HandJoint.pinkyPip,  HandJoint.pinkyTip),
    ]
    var knownCount = 0
    var extCount = 0
    var curlCount = 0
    var tips: [HLandmark] = []
    for f in fingers {
      let m = lm[f.mcp], p = lm[f.pip], t = lm[f.tip]
      if m.confidence < 0.3 || p.confidence < 0.3 || t.confidence < 0.3 { continue }
      knownCount += 1
      tips.append(t)
      let c = angleCos(m, p, t)
      if c < -0.7 {
        extCount += 1
      } else if c > -0.35 {
        curlCount += 1
      }
    }
    guard knownCount >= 2 else { return nil }

    let thumbExt = isThumbExtended(lm)
    let needMajority = max(2, knownCount - 1)
    let spread = maxPairwiseDist(tips)

    if thumbExt && extCount >= needMajority && spread > 0.8 * palmW {
      return .openPalm
    }

    if thumbExt && curlCount >= needMajority && spread < 0.7 * palmW {
      let cx = tips.reduce(Float(0)) { $0 + $1.x } / Float(tips.count)
      let cy = tips.reduce(Float(0)) { $0 + $1.y } / Float(tips.count)
      let thumbTip = lm[HandJoint.thumbTip]
      let thumbAway = distXY(thumbTip.x, thumbTip.y, cx, cy) > 0.7 * palmW
      if thumbAway {
        return .thumbsUp
      }
    }
    return nil
  }

  /// Whether the thumb is extended: CMC→TIP at least 1.4× CMC→MCP (a scale-free ratio).
  private static func isThumbExtended(_ lm: [HLandmark]) -> Bool {
    let cmc = lm[HandJoint.thumbCmc]
    let mcp = lm[HandJoint.thumbMcp]
    let tip = lm[HandJoint.thumbTip]
    if cmc.confidence < 0.3 || tip.confidence < 0.3 { return false }
    let dTip = distXY(cmc.x, cmc.y, tip.x, tip.y)
    let dMid = distXY(cmc.x, cmc.y, mcp.x, mcp.y)
    if dMid < 1e-6 { return false }
    return dTip / dMid > 1.4
  }

  /// Cosine of the angle at b in a-b-c: -1 when straight (a, b, c collinear), toward 0 and positive as it bends.
  private static func angleCos(_ a: HLandmark, _ b: HLandmark, _ c: HLandmark) -> Float {
    let v1x = a.x - b.x, v1y = a.y - b.y
    let v2x = c.x - b.x, v2y = c.y - b.y
    let n1 = (v1x * v1x + v1y * v1y).squareRoot()
    let n2 = (v2x * v2x + v2y * v2y).squareRoot()
    if n1 < 1e-6 || n2 < 1e-6 { return 0 }
    return (v1x * v2x + v1y * v2y) / (n1 * n2)
  }

  private static func dist(_ a: HLandmark, _ b: HLandmark) -> Float {
    distXY(a.x, a.y, b.x, b.y)
  }

  /// Largest pairwise distance among tips (a spread / compactness measure).
  private static func maxPairwiseDist(_ pts: [HLandmark]) -> Float {
    var mx: Float = 0
    var i = 0
    while i < pts.count {
      var j = i + 1
      while j < pts.count {
        let d = dist(pts[i], pts[j])
        if d > mx { mx = d }
        j += 1
      }
      i += 1
    }
    return mx
  }

  // MARK: - utilities

  static func distXY(_ ax: Float, _ ay: Float, _ bx: Float, _ by: Float) -> Float {
    let dx = ax - bx
    let dy = ay - by
    return (dx * dx + dy * dy).squareRoot()
  }
}
