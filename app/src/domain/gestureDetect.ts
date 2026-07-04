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
// v0.1.4: 録画の開始・終了トリガーは「指を 3 本 → 2 本 → 1 本」 のカウントダウン系列。
// 静的な 1 ポーズ (パー / サムズアップ) は家事の自然な手と幾何的に衝突して誤検出するが、
// 「決まった本数を順番に、 各段一定時間保持」 という系列が自然発生する確率は桁で低い。
// 途中で崩れても何も起きない (= フェイルセーフ) のもポーズ保持型に対する利点。
//
// 設計方針:
//   - 関節角度ベースの素朴な heuristic。 学習モデルではない。
//   - 入力 (CountableHand) と出力 (系列イベント) だけを公開し、 実装は差し替え可能に保つ。

// MARK: - 指の伸展判定

type FingerName = 'index' | 'middle' | 'ring' | 'pinky';

const FINGER_INDICES: Record<FingerName, { mcp: number; pip: number; dip: number; tip: number }> = {
  index: { mcp: J.INDEX_MCP, pip: J.INDEX_PIP, dip: J.INDEX_DIP, tip: J.INDEX_TIP },
  middle: { mcp: J.MIDDLE_MCP, pip: J.MIDDLE_PIP, dip: J.MIDDLE_DIP, tip: J.MIDDLE_TIP },
  ring: { mcp: J.RING_MCP, pip: J.RING_PIP, dip: J.RING_DIP, tip: J.RING_TIP },
  pinky: { mcp: J.PINKY_MCP, pip: J.PINKY_PIP, dip: J.PINKY_DIP, tip: J.PINKY_TIP },
};

/**
 * 非親指フィンガーが伸びているか判定。
 * MCP→TIP の距離が MCP→PIP の 1.6 倍以上なら extended、未満なら curled。
 * (折り曲げると TIP が MCP に近づくため距離比で十分検出できる)
 */
function isFingerExtended(lm: CountLandmark[], finger: FingerName): boolean {
  const f = FINGER_INDICES[finger];
  const tip = lm[f.tip];
  const pip = lm[f.pip];
  const mcp = lm[f.mcp];
  // confidence が低い landmark は判定不能 → false 寄せ
  if (tip.confidence < 0.3 || mcp.confidence < 0.3) return false;
  const dTipMcp = dist2(tip, mcp);
  const dPipMcp = dist2(pip, mcp);
  if (dPipMcp < 1e-6) return false;
  return dTipMcp > 1.6 * dPipMcp;
}

/**
 * 親指は手首-CMC-MCP-IP-TIP の構造が他指と異なるため別判定。
 * CMC→TIP の距離が CMC→MCP の 1.5 倍以上なら extended。
 */
function isThumbExtended(lm: CountLandmark[]): boolean {
  const tip = lm[J.THUMB_TIP];
  const mcp = lm[J.THUMB_MCP];
  const cmc = lm[J.THUMB_CMC];
  if (tip.confidence < 0.3 || cmc.confidence < 0.3) return false;
  const dTipCmc = dist2(tip, cmc);
  const dMcpCmc = dist2(mcp, cmc);
  if (dMcpCmc < 1e-6) return false;
  return dTipCmc > 1.5 * dMcpCmc;
}

function dist2(a: CountLandmark, b: CountLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // z は iOS で常に 0 のため平面距離で十分
  return Math.sqrt(dx * dx + dy * dy);
}

// MARK: - 指本数カウント

/**
 * 立っている指の本数 (親指込み 0..5)。 判定不能 (信頼度不足) は null。
 * どの指かは問わない (= 「3 本」 は人により親指込み・薬指込みが分かれるため本数だけ見る)。
 */
export function countExtendedFingers(hand: CountableHand): number | null {
  const quality = hand.score ?? hand.confidence ?? 0;
  if (hand.landmarks.length < 21 || quality < 0.5) return null;
  const lm = hand.landmarks;
  let n = isThumbExtended(lm) ? 1 : 0;
  for (const f of ['index', 'middle', 'ring', 'pinky'] as const) {
    if (isFingerExtended(lm, f)) n++;
  }
  return n;
}

/** frame 内で最も score の高い手の指本数。 手が無ければ null。 */
export function bestHandFingerCount(hands: CountableHand[]): number | null {
  let best: CountableHand | null = null;
  for (const h of hands) {
    if (!best || (h.score ?? h.confidence ?? 0) > (best.score ?? best.confidence ?? 0)) best = h;
  }
  return best ? countExtendedFingers(best) : null;
}

// MARK: - 3→2→1 カウントダウン系列検出

/// 各段の確定に必要な保持時間と、 段間の制限時間。 保持はサンプル多数決 (下の WINDOW) の上に乗る。
const STEP_DWELL_MS = 400;
const STEP_TIMEOUT_MS = 4000;
/// 多数決ウィンドウ (= 30Hz 入力で ~170ms。 遷移中の中間形状や単フレーム誤読を吸収)。
const SMOOTH_WINDOW = 5;

export type CountdownEvent = 'step' | 'complete';

/**
 * 「3 本 → 2 本 → 1 本」 の系列検出器。 push に毎フレームの指本数 (手なし = null) を流すと、
 * 3・2 の確定で 'step'、 1 の確定 (= 系列完了) で 'complete' を返す。
 * 期待と違う本数は無視 (= リセットしない。 遷移中のブレで系列が壊れない)。
 * 進捗が STEP_TIMEOUT_MS 途絶えたら最初からやり直し。
 */
export class CountdownSequenceDetector {
  private window: (number | null)[] = [];
  private expected = 3;
  private dwellStart = 0;
  private lastProgressTs = 0;

  /** 多数決済みの現在本数 (null = 不定)。 */
  private stableCount(): number | null {
    if (this.window.length < SMOOTH_WINDOW) return null;
    const tally = new Map<number, number>();
    for (const c of this.window) {
      if (c == null) continue;
      tally.set(c, (tally.get(c) ?? 0) + 1);
    }
    let best: number | null = null;
    let bestN = 0;
    for (const [c, n] of tally) {
      if (n > bestN) { best = c; bestN = n; }
    }
    // 過半数を要求 (= ウィンドウ内で優勢でも半分未満なら不定扱い)
    return bestN > SMOOTH_WINDOW / 2 ? best : null;
  }

  push(count: number | null, nowMs: number): CountdownEvent | null {
    this.window.push(count);
    if (this.window.length > SMOOTH_WINDOW) this.window.shift();

    // 進捗の途絶 (段の途中で放置 / 手を下ろした) は最初から。
    if (this.lastProgressTs !== 0 && nowMs - this.lastProgressTs > STEP_TIMEOUT_MS) this.resetProgress();

    const stable = this.stableCount();
    if (stable !== this.expected) {
      this.dwellStart = 0;
      return null;
    }
    if (this.dwellStart === 0) this.dwellStart = nowMs;
    if (nowMs - this.dwellStart < STEP_DWELL_MS) return null;

    // 段確定
    this.dwellStart = 0;
    this.lastProgressTs = nowMs;
    if (this.expected === 1) {
      this.resetProgress();
      return 'complete';
    }
    this.expected--;
    return 'step';
  }

  private resetProgress(): void {
    this.expected = 3;
    this.dwellStart = 0;
    this.lastProgressTs = 0;
  }

  reset(): void {
    this.window = [];
    this.resetProgress();
  }
}
