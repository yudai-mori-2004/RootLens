import {
  HAND_LANDMARK_INDICES as J,
  type HandLandmark,
  type HandObservation,
} from '../../native/handPose';

// Hand pose 21-joint からのジェスチャー判定。
//
// 設計方針:
//   - 関節角度ベースの極めて素朴な heuristic。学習モデルではない。
//   - 統合実装フェーズで MediaPipe Gesture Recognizer や独自学習モデルに差し替え可能なよう、
//     入力 (HandObservation) と出力 (GestureLabel | null) のみを公開する。
//
// 対応ジェスチャー:
//   - "thumbs_up": 親指のみ伸びていて他 4 本が折れている。さらに親指 TIP が wrist より上 (画像 Y 小さい)。
//   - "open_palm": 5 本全部が伸びている (パー)。
//
// チャタリング防止:
//   - GestureStabilizer が連続 N フレーム同じラベルを出して初めて確定する。

export type GestureLabel = 'thumbs_up' | 'open_palm';

/**
 * 1 frame の単一手の判定結果。安定化前の生 detection。
 */
export function detectGesture(hand: HandObservation): GestureLabel | null {
  if (hand.landmarks.length < 21) return null;
  if (hand.score < 0.5) return null;
  const lm = hand.landmarks;

  const thumbExt = isThumbExtended(lm);
  const indexExt = isFingerExtended(lm, 'index');
  const middleExt = isFingerExtended(lm, 'middle');
  const ringExt = isFingerExtended(lm, 'ring');
  const pinkyExt = isFingerExtended(lm, 'pinky');

  const others = [indexExt, middleExt, ringExt, pinkyExt];
  const allOthersFolded = others.every((e) => !e);
  const allOthersExtended = others.every((e) => e);

  if (thumbExt && allOthersFolded) {
    // 親指が wrist より上に来ているか (画像 top-left 原点なので y が小さい = 上)
    const thumbTip = lm[J.THUMB_TIP];
    const wrist = lm[J.WRIST];
    if (thumbTip.y < wrist.y) {
      return 'thumbs_up';
    }
  }
  if (thumbExt && allOthersExtended) {
    return 'open_palm';
  }
  return null;
}

// MARK: - Finger extension heuristics

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
function isFingerExtended(lm: HandLandmark[], finger: FingerName): boolean {
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
function isThumbExtended(lm: HandLandmark[]): boolean {
  const tip = lm[J.THUMB_TIP];
  const mcp = lm[J.THUMB_MCP];
  const cmc = lm[J.THUMB_CMC];
  if (tip.confidence < 0.3 || cmc.confidence < 0.3) return false;
  const dTipCmc = dist2(tip, cmc);
  const dMcpCmc = dist2(mcp, cmc);
  if (dMcpCmc < 1e-6) return false;
  return dTipCmc > 1.5 * dMcpCmc;
}

function dist2(a: HandLandmark, b: HandLandmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  // z は iOS で常に 0 のため平面距離で十分
  return Math.sqrt(dx * dx + dy * dy);
}

// MARK: - Stabilizer (チャタリング防止)

/**
 * 連続 N フレーム同じ label が出て初めて confirm する単純な多数決安定器。
 * 30fps を想定して default windowSize=5 (約 167ms)。
 *
 * 用途: gesture trigger を録画開始/終了に使う場合、瞬間的な誤検出をフィルタする。
 */
export class GestureStabilizer {
  private readonly windowSize: number;
  private buffer: (GestureLabel | null)[] = [];
  private lastConfirmed: GestureLabel | null = null;

  constructor(windowSize = 5) {
    this.windowSize = windowSize;
  }

  /**
   * 新しい label を投入し、安定化済み (= 直近 windowSize 連続で同じだった) ラベルを返す。
   * 確定が変わらない間は同じ値を返す。
   */
  push(label: GestureLabel | null): GestureLabel | null {
    this.buffer.push(label);
    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }
    if (this.buffer.length < this.windowSize) {
      return this.lastConfirmed;
    }
    const first = this.buffer[0];
    const allSame = this.buffer.every((l) => l === first);
    if (allSame) {
      this.lastConfirmed = first;
    }
    return this.lastConfirmed;
  }

  reset(): void {
    this.buffer = [];
    this.lastConfirmed = null;
  }
}
