import { HAND_LANDMARK_INDICES as J } from '../native/handPose';

/** 判定に必要な最小の landmark 形 (= native HandObservation / dataflow WearerHandObservation の両方が満たす)。 */
export interface CountLandmark { x: number; y: number; confidence: number; }
export interface CountableHand {
  landmarks: CountLandmark[];
  /** 検出信頼度。 native は score、 dataflow は confidence で持つ。 */
  score?: number;
  confidence?: number;
}

// Hand pose 21-joint からのジェスチャー判定。
//
// v0.1.4: 録画の開始・終了トリガーは「両手チョキを少しキープ」。 チョキは指を特定して分類する
// (= 人差し指・中指が伸び、 薬指・小指が畳まれている。 親指は人による癖が大きいので不問)。
// 「伸びている本数 = 2」 のような本数だけの判定は、 どの 2 本でも通る / 薬指の誤読で落ちる、 の
// 両方向に誤るため使わない。 伸び・畳みの閾値は分けて、 中間の曖昧な形はチョキ扱いしない。
//
// 設計方針:
//   - 関節角度ベースの素朴な heuristic。 学習モデルではない。
//   - 入力 (CountableHand) と出力 (キープイベント) だけを公開し、 実装は差し替え可能に保つ。

// MARK: - 指の伸展判定

type FingerName = 'index' | 'middle' | 'ring' | 'pinky';

const FINGER_INDICES: Record<FingerName, { mcp: number; pip: number; dip: number; tip: number }> = {
  index: { mcp: J.INDEX_MCP, pip: J.INDEX_PIP, dip: J.INDEX_DIP, tip: J.INDEX_TIP },
  middle: { mcp: J.MIDDLE_MCP, pip: J.MIDDLE_PIP, dip: J.MIDDLE_DIP, tip: J.MIDDLE_TIP },
  ring: { mcp: J.RING_MCP, pip: J.RING_PIP, dip: J.RING_DIP, tip: J.RING_TIP },
  pinky: { mcp: J.PINKY_MCP, pip: J.PINKY_PIP, dip: J.PINKY_DIP, tip: J.PINKY_TIP },
};

/**
 * 非親指フィンガーの伸展比 (= MCP→TIP 距離 / MCP→PIP 距離)。 伸ばすと ~2、 折ると ~1 未満。
 * landmark の信頼度が足りなければ null (= 判定不能)。
 */
function fingerRatio(lm: CountLandmark[], finger: FingerName): number | null {
  const f = FINGER_INDICES[finger];
  const tip = lm[f.tip];
  const pip = lm[f.pip];
  const mcp = lm[f.mcp];
  if (tip.confidence < 0.3 || mcp.confidence < 0.3) return null;
  const dPipMcp = dist2(pip, mcp);
  if (dPipMcp < 1e-6) return null;
  return dist2(tip, mcp) / dPipMcp;
}

/// 伸び / 畳みの閾値は分ける (= 中間の曖昧な形をどちらにも倒さない不感帯)。
const EXTENDED_MIN_RATIO = 1.5;
const FOLDED_MAX_RATIO = 1.35;

function dist2(a: CountLandmark, b: CountLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // z は iOS で常に 0 のため平面距離で十分
  return Math.sqrt(dx * dx + dy * dy);
}

// MARK: - チョキ (ピースサイン) 分類

/**
 * チョキか。 人差し指・中指が明確に伸び、 薬指・小指が明確に畳まれていること。
 * 親指は人による癖 (畳む / 添える) が大きいので見ない。 曖昧な中間形は false。
 */
export function isPeaceSign(hand: CountableHand): boolean {
  const quality = hand.score ?? hand.confidence ?? 0;
  if (hand.landmarks.length < 21 || quality < 0.5) return false;
  const lm = hand.landmarks;
  const index = fingerRatio(lm, 'index');
  const middle = fingerRatio(lm, 'middle');
  const ring = fingerRatio(lm, 'ring');
  const pinky = fingerRatio(lm, 'pinky');
  if (index == null || middle == null || ring == null || pinky == null) return false;
  return (
    index >= EXTENDED_MIN_RATIO &&
    middle >= EXTENDED_MIN_RATIO &&
    ring <= FOLDED_MAX_RATIO &&
    pinky <= FOLDED_MAX_RATIO
  );
}

// MARK: - 両手チョキのキープ検出

/// 位相の多数決ウィンドウ (= 30Hz 入力で ~130ms。 単フレームの誤読と両手のズレを吸収)。
const SMOOTH_WINDOW = 4;

export type PeaceHoldEvent = 'armed' | 'complete';

/** 1 フレームで「両手ともチョキ」 か。 */
function frameBothPeace(hands: CountableHand[]): boolean {
  if (hands.length < 2) return false;
  return hands.every(isPeaceSign);
}

/**
 * 「両手チョキを holdMs キープ」 の検出器。 push に毎フレームの両手を流すと、
 * 安定してチョキになった瞬間に 'armed' (= 検出ビープ用)、 保持しきったら 'complete' を返す。
 * 途中で崩れたら黙って最初から (= 誤発火しない)。
 */
export class PeaceHoldDetector {
  private window: boolean[] = [];
  private holdStart = 0;

  constructor(private readonly holdMs: number) {}

  push(hands: CountableHand[], nowMs: number): PeaceHoldEvent | null {
    this.window.push(frameBothPeace(hands));
    if (this.window.length > SMOOTH_WINDOW) this.window.shift();
    if (this.window.length < SMOOTH_WINDOW) return null;

    const stable = this.window.filter(Boolean).length > SMOOTH_WINDOW / 2;
    if (!stable) {
      this.holdStart = 0;
      return null;
    }
    if (this.holdStart === 0) {
      this.holdStart = nowMs;
      return 'armed';
    }
    if (nowMs - this.holdStart >= this.holdMs) {
      this.holdStart = 0;
      this.window = [];
      return 'complete';
    }
    return null;
  }

  reset(): void {
    this.window = [];
    this.holdStart = 0;
  }
}
