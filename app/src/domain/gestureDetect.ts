// TS 側のジェスチャー判定ポリシー。
//
// native (WearerHandClassifier) は 1 手ごとの形状分類 (open_palm / thumbs_up) までを行う。
// ここで (1) 両手を 1 フレームのジェスチャーに畳み (frameGesture)、 (2) 時間方向に安定化する
// (GestureStabilizer)。 集約・向き・平滑化を native rebuild なしで詰められるよう TS に寄せてある。

export type GestureLabel = 'thumbs_up' | 'open_palm';

// ─── フレーム集約 (両手 → 1 ジェスチャー) ──────────────────────────────

interface Vec2 {
  x: number;
  y: number;
}

type Landmark = { x: number; y: number; confidence: number };

// ── 向き判定の調整ノブ ──
// landmark は 2D 画面座標のみ (top-left 原点、 y は下ほど大きい)。 停止判定は「両手 thumbs_up
// かつ両親指が画面で明確に上を向いている」だけで済ませる。 native は握りの形しか見ないので 👎 も
// thumbs_up ラベルになる。 誤停止 (録画を事故で終わらせる不可逆操作) を防ぐ側に倒す。

// 親指ベクトルが (この倍率 × 手のひら幅) より短ければ画面向きが読めない (= カメラ手前/奥に
// 倒れて投影が潰れた) とみなす。 その手は「向き不定」= 停止不成立。
const THUMB_PROJ_MIN_RATIO = 0.3;
// 画面 y。 明確に上を向いた親指は d.y が十分負。 -0.5 は仰角約 30° 以上の上向きに相当。
// これより上向きでない親指は 1 本でもあれば停止不成立。 実機で本物のグッドが弾かれるなら
// 緩める (= 値を大きく = 0 に近く)、 誤停止が残るなら締める (= 値を小さく = -1 に近く)。
const THUMB_UP_REQUIRE_Y = -0.5;

/** 手のひら幅 (= indexMCP(5) ↔ pinkyMCP(17))。 スケール基準。 取れなければ 0。 */
function palmWidth(lm: Landmark[]): number {
  const a = lm[5];
  const b = lm[17];
  if (!a || !b || a.confidence < 0.3 || b.confidence < 0.3) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * thumbCMC(1) → thumbTip(4) の画面内正規化ベクトル。 信頼度不足、 または投影が手のひら幅に
 * 対して短すぎる (= 親指がカメラ方向を向いて潰れている) 場合は null (= 向き不定)。
 */
function thumbDirection(lm: Landmark[]): Vec2 | null {
  const cmc = lm[1];
  const tip = lm[4];
  if (!cmc || !tip || cmc.confidence < 0.3 || tip.confidence < 0.3) return null;
  const dx = tip.x - cmc.x;
  const dy = tip.y - cmc.y;
  const len = Math.hypot(dx, dy);
  const palm = palmWidth(lm);
  if (palm < 1e-5 || len < THUMB_PROJ_MIN_RATIO * palm) return null;
  return { x: dx / len, y: dy / len };
}

export interface FrameGestureHand {
  gesture: GestureLabel | null;
  landmarks: Landmark[];
}

/**
 * per-hand のサインを 1 フレームのジェスチャーに集約する。
 *
 * 開始 (open_palm) は寛容: 非 null の手が全て open_palm なら成立、 null の手は無視 (= 片手の
 * 単フレーム落ちを吸収してチカチカを防ぐ)。 誤って開始してもすぐ止められるので厳しくしない。
 *
 * 停止 (thumbs_up) は厳格: 「両手 thumbs_up ラベル、 かつ両親指が画面で明確に上を向いている」
 * のみ成立。 native は握りの形しか見ないので 👎 も thumbs_up ラベルになる。 向きの検査は TS
 * 側で必ずやる。 曖昧なフレーム (片手のみ / 向きが読めない / 上向きが弱い) は全部弾く。 誤停止
 * (録画を事故で終わらせる不可逆操作) は開始の誤爆より実害が大きいのでそちらに倒す。
 */
export function frameGesture(hands: FrameGestureHand[]): GestureLabel | null {
  const nonNull = hands.filter((h) => h.gesture != null);
  if (nonNull.length === 0) return null;

  const allThumbs = nonNull.every((h) => h.gesture === 'thumbs_up');
  const allPalm = nonNull.every((h) => h.gesture === 'open_palm');
  if (!allThumbs && !allPalm) return null;

  if (allPalm) return 'open_palm';

  if (nonNull.length < 2) return null;
  for (const h of nonNull) {
    const d = thumbDirection(h.landmarks);
    if (d === null) return null;
    if (d.y > THUMB_UP_REQUIRE_Y) return null;
  }
  return 'thumbs_up';
}

// ─── 時間方向の安定化 ──────────────────────────────────────────────

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
