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
// landmark は 2D 画面座標のみ (= 奥行き z は無い)。 top-left 原点で y は下ほど大きい
// (= キャリブの computeAdjustDirection と同じ規約)。 向き判定はすべて「画面に投影した 2D
// ベクトル」で行い、 正規化して長さを捨てる。 頭部装着の下向きカメラで親指がカメラ側 (手前/奥)
// へ倒れる回転 (= 画面水平軸まわりの回転) は、 画面内では主に「短くなる (foreshorten)」として
// 出るだけなので正規化でほぼ吸収される。 完全にカメラを向いて投影が潰れた手だけは向きが不定に
// なるので、 判定材料から外す (= その軸の回転を仕様として許容する)。

// 画面内の親指ベクトルが (この倍率 × 手のひら幅) より短ければ、 親指がカメラ方向を向いて潰れて
// いるとみなし向きを判定しない。 手前/奥への倒れを許容するための投影ガード。
const THUMB_PROJ_MIN_RATIO = 0.3;
// 明確に「画面内で下を向いた」親指だけを弾くゆるい保険 (= 純粋な 👎 落とし)。 手前/奥の倒れは
// 上の投影ガードで吸収済みなので強くしない。 実機で本物のグッドが弾かれるなら上げる。
const THUMB_DOWN_REJECT_Y = 0.6;
// 左右の親指がほぼ同じ方向を向いているか (= cos 類似度) の下限。 作業中の独立した 2 つの握りは
// 向きが無相関でここを下回り、 意図的な両手グッドは親指がほぼ平行で上回る。 誤停止が残るなら上げる。
const THUMBS_PARALLEL_MIN_COS = 0.5;

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
 * per-hand のサインを 1 フレームのジェスチャーに集約する (= 判定ポリシーの本丸)。
 * 非 null の手が全て同じサインなら採用し、 null の手は無視する (= 片手の単フレーム落ちを
 * 吸収してチカチカを防ぐ)。 異なるサインが混在したら不成立。
 *
 * thumbs_up だけは誤停止が痛いので向きゲートを重ねる (= すべて画面内 2D、 手前/奥の倒れは無視):
 *   - 各親指が明確に画面下を向いていない
 *   - 両手が揃ったフレームでは左右の親指がほぼ平行 (= バラバラな握りの偶発一致を弾く)
 * 向きが取れない手 (= 低信頼度 or カメラ方向で投影が潰れた手) は判定材料にせず、 従来の
 * ラベル一致へフォールバックする。
 */
export function frameGesture(hands: FrameGestureHand[]): GestureLabel | null {
  let g: GestureLabel | null = null;
  for (const h of hands) {
    if (h.gesture == null) continue;
    if (g === null) g = h.gesture;
    else if (g !== h.gesture) return null;
  }
  if (g !== 'thumbs_up') return g;

  const dirs: Vec2[] = [];
  for (const h of hands) {
    if (h.gesture !== 'thumbs_up') continue;
    const d = thumbDirection(h.landmarks);
    if (d === null) continue;
    if (d.y > THUMB_DOWN_REJECT_Y) return null;
    dirs.push(d);
  }
  if (dirs.length >= 2) {
    const cos = dirs[0].x * dirs[1].x + dirs[0].y * dirs[1].y;
    if (cos < THUMBS_PARALLEL_MIN_COS) return null;
  }
  return g;
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
