import Foundation

// 1 フレーム分の検出結果を分類する純粋関数群。 状態なし、 副作用なし。
//
// 分類ルール:
//
//   1. 身体ポーズが他人物 (= 装着者以外) の手首・肘・肩を画面内に検出している場合、
//      その人物の手首位置の半径 0.18 (= 画像幅の 18%) 以内にある手は他人物の手として除外する。
//
//   2. 身体ポーズが足首・膝を高 confidence で検出していて、 その位置に近い (画面の
//      6% 以内) 手は、 足・脚の誤検出として捨てる。
//
//   3. 上記いずれにも該当しない手のうち、 信頼度が高い順に最大 2 つを装着者の手として扱う。
//
//   4. ジェスチャ判定は 「装着者と判定された手の全員」 が同じサインを示しているときだけ返す。
//      片手だけが open_palm を返しているケースでは null。

enum WearerHandClassifier {

  static let bodyPointConfThreshold: Float = 0.4
  /// 遮蔽 fallback 用の wrist 信頼度しきい値 (= 通常より緩い)。
  /// Vision body pose は手首がたとえ視界の端でも比較的低い confidence で出すことがある。
  static let bodyWristConfThresholdForFallback: Float = 0.25
  static let footMisdetectDistance: Float = 0.06
  static let nonWearerHandDistance: Float = 0.18
  static let maxWearerHands: Int = 2
  // 装着者の手として採用する最低 confidence。 0.5 だと明瞭に映る手でも Vision の信頼度が一時的に
  // 割り込んで片手が消える (= パーアイコンが点滅) ため、 0.3 に緩める (= 5/5〜7 の体感に寄せる)。
  static let minHandScoreForWearer: Float = 0.3

  /// body pose の点が「実際に画面内にあるか」 を判定する。
  /// 重要: confidence だけだと、 Vision は画面外でも arm から幻覚予測することがあるので
  /// 正規化座標 [0,1] 範囲チェックも併用する。
  static func isInFrame(_ p: BodyPoint?, confThreshold: Float) -> Bool {
    guard let p = p else { return false }
    return p.confidence >= confThreshold &&
           p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
  }

  static func classify(hands: [RawHand], body: RawBody?) -> FrameClassification {

    // 他人物の手の spatial proxy を集める。 body の wrist が最も信用できるので優先、
    // wrist が無い時に肘・肩で代用 (大雑把だが、 他人物が画面の前にいるかを判定する目的)。
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

    // 足・脚の位置 (= 足の誤検出判定用)。 膝も含める。
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

      // hand 全体の信頼度が低すぎる物は弾く (= ノイズ抑制)
      if hand.confidence < minHandScoreForWearer {
        classified.append(ClassifiedHand(raw: hand, isWearer: false, isFootMisdetect: false))
        continue
      }

      let wrist = hand.landmarks[wristIdx]
      let hx = wrist.x
      let hy = wrist.y

      // 足・脚の誤検出判定
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

      // 他人物の手かどうか
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

    // 「装着者の手」 として採用するのは最大 2 つ (= 信頼度高い順)。 それ以上を装着者扱いすると
    // 他人物の手まで取り込んでしまうリスクがある。
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

    // 遮蔽 fallback: hand pose で 2 手未満しか取れなかった時、 body pose の wrist で補う。
    // 装着者の身体特徴 = 肩 / 肘が画面に映ってない (= ヘッドマウントだと自分の上半身はカメラ外)。
    // この前提で、 body 側の wrist が画面内に居れば、 hand pose が拾えなかった遮蔽中の手と判定する。
    var augmentedClassified = finalClassified
    let currentWearerHands = finalClassified.filter { $0.isWearer }
    if currentWearerHands.count < 2, let b = body {
      let shoulderInFrame = (b.leftShoulder?.confidence ?? 0) >= bodyPointConfThreshold ||
                            (b.rightShoulder?.confidence ?? 0) >= bodyPointConfThreshold
      let elbowInFrame    = (b.leftElbow?.confidence ?? 0) >= bodyPointConfThreshold ||
                            (b.rightElbow?.confidence ?? 0) >= bodyPointConfThreshold
      // 装着者の身体は 肩 / 肘 が画面内に映らない、 という条件
      if !shoulderInFrame && !elbowInFrame {
        let bodyWrists: [BodyPoint] = [b.leftWrist, b.rightWrist].compactMap { $0 }
          .filter { p in
            p.confidence >= bodyPointConfThreshold &&
            p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
          }
        for bw in bodyWrists {
          // 既存の装着者の手と十分離れていれば、 新しい synthetic な手として追加
          let alreadyMatched = currentWearerHands.contains { hand in
            let hWrist = hand.raw.landmarks[HandJoint.wrist]
            return distXY(bw.x, bw.y, hWrist.x, hWrist.y) < 0.15
          }
          if !alreadyMatched {
            // 21 関節中 wrist のみを高 confidence で埋め、 残りは confidence 0 (= 未検出)
            var lms: [HLandmark] = Array(repeating: HLandmark(x: 0, y: 0, confidence: 0), count: 21)
            lms[HandJoint.wrist] = HLandmark(x: bw.x, y: bw.y, confidence: bw.confidence)
            let synthetic = RawHand(handedness: "unknown", confidence: bw.confidence, landmarks: lms)
            augmentedClassified.append(ClassifiedHand(raw: synthetic, isWearer: true, isFootMisdetect: false))
            if augmentedClassified.filter({ $0.isWearer }).count >= maxWearerHands { break }
          }
        }
      }
    }

    // augmented を最終結果に
    let finalAll = augmentedClassified
    let wearerHands = finalAll.filter { $0.isWearer }
    let wearerCount = wearerHands.count

    // gesture の集約 (= 両手の合議 / 単フレーム nil 許容) は TS 側で行う。 native は per-hand の
    // detectGesture を payload に載せるだけ (= wide と同方針、 判定ポリシーを再ビルド不要で詰める)。
    return FrameClassification(hands: finalAll, wearerHandCount: wearerCount)
  }

  // MARK: - サイン判定 (= wide-capture と同一ロジックに統一)
  //
  // ヘッドマウント下向き視点での 2 大誤りを構造的に潰す形状ベース判定 (= wide と同一)。 詳細は wide 側コメント。
  //   ・タイピング → thumbs_up 誤検出: 画像 y を使わず、 握りのコンパクトさ + 親指の突き出しで判定。
  //   ・全力パー → 未検出: 5 本 AND をやめ N-of-known + 低信頼度の指は「不明」扱い。
  //   ・伸展/屈曲は関節角度、 距離は掌幅で正規化。
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

  /// 親指が伸びているか。 CMC→TIP が CMC→MCP の 1.4 倍以上 (= 掌幅非依存の比)。
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

  /// 3 点 a-b-c の b における角の cos。 直線 (b が中点で a,c が一直線) で -1、 屈曲で 0 / 正へ。
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

  /// tips の最大ペア間距離 (= 開き/コンパクトさの指標)。
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
