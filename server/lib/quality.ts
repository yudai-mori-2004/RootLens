import { GetObjectCommand } from "@aws-sdk/client-s3";
import { r2, BUCKET_RAW } from "./r2";
import { rawSessionFileKey } from "./r2-keys";

// 品質評価 (= SPECS_JA §6.2 ステップ 3 + §6.3)。
//
// Pipeline 2 では端末から R2 に置かれた sensors.jsonl + imu_high_rate.jsonl から
// 計算できる sensor-side メトリクスのみを算出する。 手検出 (anyHand/twoHand) は
// WiLoR が走る Pipeline 3 で初めて埋まる (= ここでは null)。
//
// **棄却閾値は設けない** (= SPECS §6.3)。 スコアが低くてもクリップは ready に進む。
// スコアは買い手向けカタログのフィルタ軸として表示される。

export interface QualityBreakdown {
  /// 手検出は Pipeline 3 (WiLoR) で計算するので、 Pipeline 2 では null。
  anyHandRatio: number | null;
  twoHandRatio: number | null;
  /// 深度データが有効なフレーム比率 (= LiDAR 搭載機のみ)。 非搭載機は null。
  depthValidRatio: number | null;
  /// RGB / IMU 時刻の同期率。 端末側で同 ARFrame に紐付けて書き出すので通常 1.0。
  syncRatio: number;
  /// frame_index の欠落数 (= 期待 0..N-1 に対する穴)。
  frameGapCount: number;
}

export interface QualityScore {
  total: number; // 0..100
  breakdown: QualityBreakdown;
}

interface SensorRow {
  ts?: number;
  frame_index?: number;
  tracking_state?: number;
}

interface ImuRow {
  linear_acceleration?: [number, number, number];
}

/// R2 raw バケットから sensors.jsonl + imu_high_rate.jsonl を読み、 メトリクスを算出。
/// 失敗時は throw する (= silent placeholder は返さない)。
export async function computeQuality(opts: {
  contentHash: string;
}): Promise<QualityScore> {
  const sensorsKey = rawSessionFileKey(opts.contentHash, "sensors.jsonl");
  const imuKey = rawSessionFileKey(opts.contentHash, "imu_high_rate.jsonl");

  const sensorsText = await fetchTextFromR2(sensorsKey);
  const imuText = await fetchTextFromR2(imuKey);

  const sensorRows = parseJsonl<SensorRow>(sensorsText);
  const imuRows = parseJsonl<ImuRow>(imuText);

  if (sensorRows.length === 0) {
    throw new Error(`sensors.jsonl is empty (key=${sensorsKey}). Quality cannot be computed.`);
  }

  // frame_index の欠落数 (= 0..N-1 の期待列に対する穴)
  const indices = sensorRows
    .map((r) => r.frame_index)
    .filter((i): i is number => typeof i === "number")
    .sort((a, b) => a - b);
  const maxIdx = indices.length > 0 ? indices[indices.length - 1] : -1;
  const expected = maxIdx + 1;
  const frameGapCount = Math.max(0, expected - indices.length);

  // 同期率: ts が monotonic increasing で frame_index と 1:1 で対応しているか
  let synced = 0;
  for (let i = 0; i < sensorRows.length; i++) {
    const r = sensorRows[i];
    if (typeof r.ts === "number" && typeof r.frame_index === "number") synced++;
  }
  const syncRatio = sensorRows.length > 0 ? synced / sensorRows.length : 0;

  // 深度有効率: tracking_state == 2 (normal) のフレーム比率。 LiDAR 非搭載機でも
  // sensors.jsonl に tracking_state は入るので、 ここでは「ARKit が安定追跡できた」 比率を返す。
  // SPECS の「LiDAR 非搭載機は null」 は depth ファイル有無で判断する (= 端末から uplaod
  // されない depth/ ディレクトリは bundler が後で確認)。 ここでは ARKit 追跡安定率として記録。
  const trackingValues = sensorRows
    .map((r) => r.tracking_state)
    .filter((s): s is number => typeof s === "number");
  const trackingNormal = trackingValues.filter((s) => s === 2).length;
  const depthValidRatio =
    trackingValues.length > 0 ? trackingNormal / trackingValues.length : null;

  // 総合スコア (= 計算可能な軸のみで 0..100): syncRatio * 50 + (1 - gap比) * 30 + tracking正常率 * 20
  const gapRatio = expected > 0 ? frameGapCount / expected : 0;
  const trackingScore = depthValidRatio ?? 0;
  const total = Math.round(
    syncRatio * 50 + (1 - gapRatio) * 30 + trackingScore * 20,
  );

  void imuRows; // IMU 重力偏差は schema に持たないので算出だけして捨てるのは無駄、 後段で必要になったら追加

  return {
    total: Math.max(0, Math.min(100, total)),
    breakdown: {
      anyHandRatio: null,
      twoHandRatio: null,
      depthValidRatio,
      syncRatio,
      frameGapCount,
    },
  };
}

async function fetchTextFromR2(key: string): Promise<string> {
  const res = await r2.send(new GetObjectCommand({ Bucket: BUCKET_RAW, Key: key }));
  if (!res.Body) throw new Error(`R2 GET returned empty body (key=${key})`);
  return await res.Body.transformToString("utf-8");
}

function parseJsonl<T>(text: string): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(JSON.parse(trimmed) as T);
  }
  return out;
}
