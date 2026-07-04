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
// v0.1.4: 録画の開始・終了トリガーは「両手でグー ⇄ チョキを 3 往復」 (= ダブルクォーテーションの
// ハンドサインの要領)。 静的な 1 ポーズ (パー / サムズアップ) は家事の自然な手と幾何的に衝突して
// 誤検出するが、 「両手同時に、 決まった 2 形を往復する」 という時間パターンの自然発生率は桁で低い。
// グー (0 本) とチョキ (2 本) は指本数判定の中で最も堅い 2 形 (= 薬指・小指の区別に依存しない)。
// 途中で崩れても何も起きない (= フェイルセーフ)。
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

// MARK: - グー ⇄ チョキ往復の検出

/// 完了に必要な位相変化の回数 (= グー→チョキ or チョキ→グーで 1)。 6 = 3 往復。
const REQUIRED_FLIPS = 6;
/// 位相変化がこれだけ途絶えたら進捗リセット (= 途中でやめた)。
const FLIP_GAP_TIMEOUT_MS = 1500;
/// 位相の多数決ウィンドウ (= 30Hz 入力で ~130ms。 両手の切替タイミングの微妙なズレを吸収)。
const SMOOTH_WINDOW = 4;

type Phase = 'gu' | 'choki';
export type CountdownEvent = 'step' | 'complete';

/** 1 フレームの両手位相。 両手が同じ形のときだけ確定、 それ以外 (片手・遷移中・別の形) は null。 */
function framePhase(hands: CountableHand[]): Phase | null {
  if (hands.length < 2) return null;
  const counts = hands.map(countExtendedFingers);
  if (counts.some((c) => c == null)) return null;
  // グーは親指が畳みきれず 1 本に読まれることが多いので 0..1 を許容。 チョキは 2 本ちょうど。
  if (counts.every((c) => c! <= 1)) return 'gu';
  if (counts.every((c) => c === 2)) return 'choki';
  return null;
}

/**
 * 「両手でグー ⇄ チョキを 3 往復」 の検出器。 push に毎フレームの両手を流すと、
 * 位相が切り替わるたびに 'step' (= ブリップ用)、 REQUIRED_FLIPS 回目で 'complete' を返す。
 * 片手しか見えない・別の形・切替の途絶 (FLIP_GAP_TIMEOUT_MS) では進捗が消えるだけで、
 * 誤って発火することはない。
 */
export class GuChokiDetector {
  private window: (Phase | null)[] = [];
  private lastPhase: Phase | null = null;
  private flips = 0;
  private lastFlipTs = 0;

  /** 多数決済みの現在位相 (null = 不定)。 */
  private stablePhase(): Phase | null {
    if (this.window.length < SMOOTH_WINDOW) return null;
    let gu = 0;
    let choki = 0;
    for (const p of this.window) {
      if (p === 'gu') gu++;
      else if (p === 'choki') choki++;
    }
    if (gu > SMOOTH_WINDOW / 2) return 'gu';
    if (choki > SMOOTH_WINDOW / 2) return 'choki';
    return null;
  }

  push(hands: CountableHand[], nowMs: number): CountdownEvent | null {
    this.window.push(framePhase(hands));
    if (this.window.length > SMOOTH_WINDOW) this.window.shift();

    // 切替の途絶は進捗リセット (= 現在の位相からやり直し)。
    if (this.flips > 0 && nowMs - this.lastFlipTs > FLIP_GAP_TIMEOUT_MS) this.flips = 0;

    const phase = this.stablePhase();
    if (phase == null) return null;
    if (this.lastPhase == null) {
      this.lastPhase = phase; // 初期位相はカウントしない
      return null;
    }
    if (phase === this.lastPhase) return null;

    // 位相が切り替わった
    this.lastPhase = phase;
    this.flips++;
    this.lastFlipTs = nowMs;
    if (this.flips >= REQUIRED_FLIPS) {
      this.flips = 0;
      this.lastFlipTs = 0;
      return 'complete';
    }
    return 'step';
  }

  reset(): void {
    this.window = [];
    this.lastPhase = null;
    this.flips = 0;
    this.lastFlipTs = 0;
  }
}
