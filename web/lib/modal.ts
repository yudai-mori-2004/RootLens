// Modal クラウド関数を Node.js から HTTP 経由で呼ぶラッパ。
//
// Pipeline 2 (= 自動): 4 層スコアリング + GTSAM
//   - MODAL_METADATA_ENDPOINT      第 1 層 (= sensors.jsonl + imu_high_rate.jsonl)
//   - MODAL_FRAME_SAMPLING_ENDPOINT 第 2 層 (= フレームサンプル画像解析)
//   - MODAL_VLM_ENDPOINT           第 3 層 (= Claude Haiku 4.5)
//   - MODAL_GTSAM_ENDPOINT         GTSAM (= Video-IMU 整合性検証)
//
// Pipeline 3 (= 手動):
//   - MODAL_BUNDLE_ENDPOINT        WiLoR + LeRobot v3
//
// 全 endpoint は @modal.fastapi_endpoint(method="POST") で公開され、 引数は FastAPI の
// query string で受ける。 大きいバイナリは HTTP body で運ばず、 Modal 側が R2 から
// 直接読み書きする。
//
// この module は workflow worker context (= ESM only sandbox) に取り込まれる可能性が
// あるので、 top-level で AWS SDK 等は import しない (= fetch のみ)。

import type { Layer1Score, Layer2Score, Layer3Score, GtsamScore } from "@/shared/api-types";

// ─── 共通 helper ──────────────────────────────────────────────────────

async function callModal<T>(endpointEnv: string, params: Record<string, string>): Promise<T> {
  const base = process.env[endpointEnv];
  if (!base) throw new Error(`${endpointEnv} is not set.`);
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), { method: "POST" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal ${endpointEnv} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

// ─── Pipeline 2 各層 ──────────────────────────────────────────────────

export async function callMetadataScore(opts: { contentId: string }): Promise<Layer1Score> {
  return await callModal<Layer1Score>("MODAL_METADATA_ENDPOINT", {
    content_id: opts.contentId,
  });
}

export async function callFrameSampling(opts: {
  contentId: string;
  sampleIntervalSec?: number;
}): Promise<Layer2Score> {
  const params: Record<string, string> = { content_id: opts.contentId };
  if (opts.sampleIntervalSec !== undefined) {
    params.sample_interval_sec = String(opts.sampleIntervalSec);
  }
  return await callModal<Layer2Score>("MODAL_FRAME_SAMPLING_ENDPOINT", params);
}

export async function callVlmScore(opts: {
  contentId: string;
  taskId: string;
  vlmIntervalSec?: number;
}): Promise<Layer3Score> {
  const params: Record<string, string> = {
    content_id: opts.contentId,
    task_id: opts.taskId,
  };
  if (opts.vlmIntervalSec !== undefined) {
    params.vlm_interval_sec = String(opts.vlmIntervalSec);
  }
  return await callModal<Layer3Score>("MODAL_VLM_ENDPOINT", params);
}

export async function callGtsam(opts: { contentId: string }): Promise<GtsamScore> {
  return await callModal<GtsamScore>("MODAL_GTSAM_ENDPOINT", {
    content_id: opts.contentId,
  });
}

// ─── Pipeline 3: WiLoR + LeRobot v3 ───────────────────────────────────

export interface BundleRequest {
  /// 生データ prefix (= raw/<content_id>/)
  rawPrefix: string;
  /// 端末から R2 にあがった C2PA D2 署名済 + ぼかし済 MP4 のキー (= raw/<content_id>/rgb.mp4)
  signedMp4Key: string;
  /// 出力 LeRobot dataset の R2 prefix (= datasets/<root_asset_id>/)
  outputPrefix: string;
  /// TP Root NFT asset id
  rootAssetId: string;
  /// 冪等性キー (= 同じ key で 2 回目は cached 経路で短絡)
  idempotencyKey: string;
}

export interface BundleResult {
  totalFrames: number;
  fps: number;
  /// hands detected per frame の平均 (= cached 経路では null)
  handsDetectedAvg: number | null;
  durationMs: number | null;
  uploadedFiles: number | null;
  cached: boolean;
}

export async function callBundle(req: BundleRequest): Promise<BundleResult> {
  return await callModal<BundleResult>("MODAL_BUNDLE_ENDPOINT", {
    raw_prefix: req.rawPrefix,
    signed_mp4_key: req.signedMp4Key,
    output_prefix: req.outputPrefix,
    root_asset_id: req.rootAssetId,
    idempotency_key: req.idempotencyKey,
  });
}
