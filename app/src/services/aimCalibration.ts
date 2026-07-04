// カメラ照準の較正 (= 装着時の IMU 誘導 + セッション実績からの逐次補正)。
//
// 設計 (2026-07-04 議論):
//   較正点は「クリップ開始前のマウント角合わせ」ただ一つ。 直立して遠方を注視した姿勢で、
//   カメラ軸の俯角 (重力基準) が目標角に入るまで TTS で誘導する。 姿勢に「狙う・保持する」
//   要素を持ち込まない (= 自然な感覚で合わせると個人差が大きすぎる、 という実測に基づく)。
//
//   目標俯角 = 事前分布 (人体幾何からの決め打ち) + 学習済み補正 (前クリップの手の分布から)。
//   録画中は手の在圏統計を貯め、 録画終了時に「手密度の山と狙い高さのズレ」を視野角で角度に
//   換算し、 減衰付きで次回の目標角へ反映する (= 確率近似の逐次補正)。
//
//   統計は最頻値ベース: 画面端で分布が打ち切られても、 山が画面内にある限り山の位置は不変。
//   山ごと画面外 (= 在圏率が低く下端に張り付く) の場合は補正ステップ上限をそのまま適用する。

import { useEffect, useRef, useState } from 'react';
import { Accelerometer, type AccelerometerMeasurement } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';

import type { HandTrackEvent } from '../dataflow';

// ─── 角度定数 ─────────────────────────────────────────────────────────

/// 事前分布の目標俯角 (deg、 下向き正)。 立位・正面視の頭に対し、 台所仕事の手 (水平から
/// 45〜60° 下) が作業時の頭部前傾 (15〜25°) 込みで画面の中〜下段に収まる角度。
/// 2026-07-04 実機フィードバック: 22° では筆記時のペン先が下から 1/3 (y≈0.67)。 狙い (y=0.55)
/// との差 ≈ +6° を反映して 28° に引き上げ。
export const AIM_PRIOR_PITCH_DOWN_DEG = 28;

/// 誘導の許容幅と、 許容内で安定したとみなすまでの時間。 手でマウントを傾ける精度が ±2〜3° なので
/// これ以上シビアにしても操作が空回りする。
export const AIM_TOLERANCE_DEG = 3;
export const AIM_STABLE_MS = 1200;

/// ARKit (iPhone 12 系 ARWorldTracking) の録画フレームは 1920×1440 (4:3 横長)。
/// wide カメラ 26mm 相当の縦視野 ≈ 53°。 補正ステップは減衰付き反復なので誤差は収束に吸収される。
const VFOV_DEG = 53;

/// 手密度の山を置きたいフレーム内高さ (0=上端, 1=下端)。 真ん中ではなくやや下 (= 上に操作対象と
/// 次に手が伸びる先の文脈を残す。 エゴセントリックデータセットの標準的な分布に合わせる)。
const TARGET_MODE_Y = 0.55;

/// 逐次補正: 測定ズレの 6 割だけ動かす (打ち切りによる過小評価と合わせて振動を防ぐ)。
/// 3° 未満は無視 (手調整の精度以下)、 1 回の補正は ±5° まで。
const UPDATE_DAMPING = 0.6;
const UPDATE_DEADZONE_DEG = 3;
const UPDATE_MAX_STEP_DEG = 5;
/// 学習補正の可動域と、 合成後の目標俯角の絶対クランプ。
const OFFSET_RANGE_DEG = { min: -8, max: 14 } as const;
const TARGET_RANGE_DEG = { min: 12, max: 38 } as const;

const STORAGE_KEY = '@rootlens/aim/v1';

// ─── 学習済み補正の永続化 ─────────────────────────────────────────────

interface LearnedAim {
  offsetDeg: number;
  clips: number;
  updatedAt: number;
}

let learned: LearnedAim = { offsetDeg: 0, clips: 0, updatedAt: 0 };
let learnedLoaded = false;

export async function loadLearnedAim(): Promise<void> {
  if (learnedLoaded) return;
  learnedLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) learned = { ...learned, ...(JSON.parse(raw) as Partial<LearnedAim>) };
  } catch {
    // 読めなければ事前分布のみで動く
  }
}

function persistLearned(): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(learned)).catch(() => {});
}

/** 現在の目標俯角 (deg、 下向き正)。 loadLearnedAim 後に呼ぶ。 */
export function aimTargetPitchDownDeg(): number {
  const t = AIM_PRIOR_PITCH_DOWN_DEG + learned.offsetDeg;
  return Math.min(TARGET_RANGE_DEG.max, Math.max(TARGET_RANGE_DEG.min, t));
}

// ─── カメラ俯角の読み取り (= 加速度計の重力ベクトル) ──────────────────
//
// 背面カメラの光軸は端末座標の -z。 準静的なら加速度計の読みが重力方向なので、
// 俯角 = asin(-z成分)。 iOS の符号規約 (画面上向き静置で z ≈ -1g) で検証:
//   画面上向き静置 (カメラ真下) → -(-1) = +1 → +90° ✓
//   直立 (カメラ水平)           → z ≈ 0    → 0°  ✓
// 端末の UI 向き (横持ち) には依存しない。

function pitchDownDegOf(r: AccelerometerMeasurement): number | null {
  const mag = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z);
  if (mag < 0.5 || mag > 1.5) return null; // 大きく動かしている最中は読まない
  const s = Math.min(1, Math.max(-1, -r.z / mag));
  return (Math.asin(s) * 180) / Math.PI;
}

export interface CameraPitchReading {
  /** 平滑化済み俯角 (deg、 下向き正)。 センサー未取得 / 激しい動きの間は null。 */
  pitchDownDeg: number | null;
  /** センサーが使えない端末 (= 誘導フェーズをスキップすべき) なら false。 */
  available: boolean;
}

/**
 * カメラ俯角の購読 hook。 active の間だけ加速度計を回す (~10Hz、 EMA 平滑)。
 * 値は ref で返す (= 状態機械の 100ms ticker から読む。 毎サンプル再描画しない)。
 * HUD 表示用に丸めた俯角だけ state でも返す。
 */
export function useCameraPitch(active: boolean): {
  readingRef: React.MutableRefObject<CameraPitchReading>;
  hudPitchDeg: number | null;
} {
  const readingRef = useRef<CameraPitchReading>({ pitchDownDeg: null, available: true });
  const [hudPitchDeg, setHudPitchDeg] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      readingRef.current = { ...readingRef.current, pitchDownDeg: null };
      setHudPitchDeg(null);
      return;
    }
    let ema: number | null = null;
    let cancelled = false;

    Accelerometer.isAvailableAsync()
      .then((ok) => {
        if (!cancelled && !ok) readingRef.current = { pitchDownDeg: null, available: false };
      })
      .catch(() => {});

    Accelerometer.setUpdateInterval(100);
    const sub = Accelerometer.addListener((m) => {
      const raw = pitchDownDegOf(m);
      if (raw == null) return;
      ema = ema == null ? raw : ema + 0.25 * (raw - ema);
      readingRef.current = { pitchDownDeg: ema, available: true };
    });
    const hudTimer = setInterval(() => {
      const p = readingRef.current.pitchDownDeg;
      setHudPitchDeg(p == null ? null : Math.round(p));
    }, 250);
    return () => {
      cancelled = true;
      sub.remove();
      clearInterval(hudTimer);
    };
  }, [active]);

  return { readingRef, hudPitchDeg };
}

// ─── 録画中の手の在圏統計 ─────────────────────────────────────────────

const LANDMARK_CONF = 0.3;
const HIST_BINS = 20;
/// 端バンド (= フレーム高さの上下 15%)。 張り付き検出と出入り非対称の判定に使う。
const EDGE_BAND = 0.15;
/// 補正に必要な最少サンプル数 (手 1 つ = 1 サンプル、 ~30Hz なので 20 秒相当)。
const MIN_SAMPLES_FOR_UPDATE = 600;

/** 見えている各手の中心 y (0..1) を返す。 手が無ければ空配列。 */
function handCenterYs(e: HandTrackEvent): number[] {
  const ys: number[] = [];
  for (const hand of e.wearerHands) {
    let sum = 0;
    let n = 0;
    for (const lm of hand.landmarks) {
      if (lm.confidence < LANDMARK_CONF) continue;
      sum += lm.y;
      n++;
    }
    if (n >= 5) ys.push(sum / n);
  }
  return ys;
}

/**
 * 1 クリップぶんの手の在圏統計。 録画開始で作り、 per-frame add、 録画終了で updateLearnedAim へ。
 */
export class SessionAimStats {
  private hist = new Array<number>(HIST_BINS).fill(0);
  private samples = 0;
  private frames = 0;
  private framesWithHand = 0;

  add(e: HandTrackEvent): void {
    this.frames++;
    const ys = handCenterYs(e);
    if (ys.length > 0) this.framesWithHand++;
    for (const y of ys) {
      const bin = Math.min(HIST_BINS - 1, Math.max(0, Math.floor(y * HIST_BINS)));
      this.hist[bin]++;
      this.samples++;
    }
  }

  /** 手密度の山 (0..1)。 [1,2,1] 平滑後のピーク bin の中心。 */
  modeY(): number | null {
    if (this.samples < MIN_SAMPLES_FOR_UPDATE) return null;
    let best = 0;
    let bestVal = -1;
    for (let i = 0; i < HIST_BINS; i++) {
      const v =
        (this.hist[i - 1] ?? 0) * 1 + this.hist[i] * 2 + (this.hist[i + 1] ?? 0) * 1;
      if (v > bestVal) {
        bestVal = v;
        best = i;
      }
    }
    return (best + 0.5) / HIST_BINS;
  }

  presenceRate(): number {
    return this.frames > 0 ? this.framesWithHand / this.frames : 0;
  }

  private edgeShare(top: boolean): number {
    if (this.samples === 0) return 0;
    const band = Math.round(HIST_BINS * EDGE_BAND);
    let n = 0;
    for (let i = 0; i < band; i++) n += this.hist[top ? i : HIST_BINS - 1 - i];
    return n / this.samples;
  }

  /** 「山ごと下に外れている」 シグネチャ (= 在圏率が低く、 出現が下端バンドに偏る)。
   *  30 秒相当のフレームが貯まるまでは判定しない (= 短いクリップの偶然で ±5° 動かさない)。 */
  censoredBelow(): boolean {
    if (this.frames < 900) return false;
    return this.presenceRate() < 0.4 && this.edgeShare(false) > 2 * this.edgeShare(true);
  }
}

/**
 * クリップ終了時に呼ぶ。 手密度の山と狙い高さのズレから学習補正を更新し、 適用した差分 (deg) を
 * 返す (0 = 補正なし)。 サンプル不足時は何もしない。
 */
export function updateLearnedAim(stats: SessionAimStats): number {
  const mode = stats.modeY();
  let rawDeg: number;
  if (mode != null) {
    // y は下向き正: 山が狙いより下 (mode > target) ならカメラをもっと下へ (= 俯角を増やす)。
    rawDeg = (mode - TARGET_MODE_Y) * VFOV_DEG;
    // 山が下端 bin に張り付く打ち切りでは実ズレはこれ以上 → 上限ステップまで許す。
    if (stats.censoredBelow()) rawDeg = Math.max(rawDeg, UPDATE_MAX_STEP_DEG / UPDATE_DAMPING);
  } else if (stats.censoredBelow()) {
    rawDeg = UPDATE_MAX_STEP_DEG / UPDATE_DAMPING;
  } else {
    return 0;
  }

  if (Math.abs(rawDeg) < UPDATE_DEADZONE_DEG) return 0;
  const step = Math.min(UPDATE_MAX_STEP_DEG, Math.max(-UPDATE_MAX_STEP_DEG, rawDeg * UPDATE_DAMPING));
  const next = Math.min(OFFSET_RANGE_DEG.max, Math.max(OFFSET_RANGE_DEG.min, learned.offsetDeg + step));
  const applied = next - learned.offsetDeg;
  if (applied === 0) return 0;
  learned = { offsetDeg: next, clips: learned.clips + 1, updatedAt: Date.now() };
  persistLearned();
  return applied;
}

// ─── 録画中の「かけ直し提案」 監視 ─────────────────────────────────────
//
// 手が画面から外れて録れていない状態が続いたときだけ、 1 クリップ 1 回まで
// 「一度撮影を終えて、 かけ直す」 ことを TTS で提案する。 位置ズレだけなら介入しない
// (= データはまだ使える。 補正は次クリップ開始時の較正に任せる)。
// 「照準が上すぎる」 シグネチャ (= 下端に頻繁に現れてはすぐ切れる) に限って発火し、
// カメラに収まらない作業 (物干し等) では鳴らさない。

const MONITOR_WINDOW_SEC = 150;
const MONITOR_MIN_SEC = 120;
const MONITOR_PRESENCE_THRESHOLD = 0.45;

interface SecondBucket {
  frames: number;
  withHand: number;
  bottomBand: number;
  topBand: number;
}

export class RedoMonitor {
  private buckets: SecondBucket[] = [];
  private curSec = -1;
  private fired = false;

  add(e: HandTrackEvent, nowMs: number): void {
    const sec = Math.floor(nowMs / 1000);
    if (sec !== this.curSec) {
      this.curSec = sec;
      this.buckets.push({ frames: 0, withHand: 0, bottomBand: 0, topBand: 0 });
      if (this.buckets.length > MONITOR_WINDOW_SEC) this.buckets.shift();
    }
    const b = this.buckets[this.buckets.length - 1];
    b.frames++;
    const ys = handCenterYs(e);
    if (ys.length > 0) b.withHand++;
    for (const y of ys) {
      if (y > 1 - EDGE_BAND) b.bottomBand++;
      if (y < EDGE_BAND) b.topBand++;
    }
  }

  /** 発火条件を満たした最初の 1 回だけ true。 */
  shouldSuggestRedo(): boolean {
    if (this.fired || this.buckets.length < MONITOR_MIN_SEC) return false;
    let frames = 0;
    let withHand = 0;
    let bottom = 0;
    let top = 0;
    for (const b of this.buckets) {
      frames += b.frames;
      withHand += b.withHand;
      bottom += b.bottomBand;
      top += b.topBand;
    }
    if (frames === 0) return false;
    const presence = withHand / frames;
    // 下端バンドへの出現がそれなりにあり (= 手は届きかけている)、 かつ上端の 2 倍超に偏る。
    const bottomHeavy = bottom > 2 * top && bottom > frames * 0.05;
    if (presence < MONITOR_PRESENCE_THRESHOLD && bottomHeavy) {
      this.fired = true;
      return true;
    }
    return false;
  }
}
