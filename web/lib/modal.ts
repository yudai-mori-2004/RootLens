// Modal クラウド関数を Node.js から HTTP 経由で呼ぶラッパ。
//
// Pipeline 2 (= 自動): 3 層スコアリング + 自動分類
//   - MODAL_METADATA_ENDPOINT      第 1 層 (= realtime_handpose.jsonl から手検出率等を算出)
//   - MODAL_FRAME_SAMPLING_ENDPOINT 第 2 層 (= フレームサンプル画像解析)
//   - MODAL_VLM_ENDPOINT           第 3 層 (= Claude Haiku 4.5、 65 点 + 自動分類カテゴリ)
//
// Pipeline 3 (= 手動): GPU 重処理
//   - MODAL_WILOR_ENDPOINT         WiLoR 手ポーズ推定 → processed/<signature_hash>/wilor.jsonl
//
// 全 endpoint は @modal.fastapi_endpoint(method="POST") で公開され、 引数は FastAPI の
// query string で受ける。 大きいバイナリは HTTP body で運ばず、 Modal 側が R2 から
// 直接読み書きする。
//
// この module は workflow worker context (= ESM only sandbox) に取り込まれる可能性が
// あるので、 top-level で AWS SDK 等は import しない (= fetch のみ)。

import type { AutoCategory, Layer1Score, Layer2Score, Layer3Score } from "@/shared/api-types";

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

export async function callMetadataScore(opts: { signatureHash: string }): Promise<Layer1Score> {
  return await callModal<Layer1Score>("MODAL_METADATA_ENDPOINT", {
    signature_hash: opts.signatureHash,
  });
}

export async function callFrameSampling(opts: {
  signatureHash: string;
  sampleIntervalSec?: number;
}): Promise<Layer2Score> {
  const params: Record<string, string> = { signature_hash: opts.signatureHash };
  if (opts.sampleIntervalSec !== undefined) {
    params.sample_interval_sec = String(opts.sampleIntervalSec);
  }
  return await callModal<Layer2Score>("MODAL_FRAME_SAMPLING_ENDPOINT", params);
}

/// 2026-05-27: tasks 事前選択撤去で task_id 引数を撤去。 VLM が映像から自律的に分類。
/// 返値に autoCategory / autoCategoryConfidence / frameLabels が追加 (= Layer3Score を拡張)。
export interface VlmScoreResult extends Layer3Score {
  autoCategory: AutoCategory;
  autoCategoryConfidence: number;
  frameLabels: Array<{
    frameIdx: number;
    tsSec: number;
    category: AutoCategory;
    description: string;
  }>;
}

export async function callVlmScore(opts: {
  signatureHash: string;
  vlmIntervalSec?: number;
}): Promise<VlmScoreResult> {
  const params: Record<string, string> = {
    signature_hash: opts.signatureHash,
  };
  if (opts.vlmIntervalSec !== undefined) {
    params.vlm_interval_sec = String(opts.vlmIntervalSec);
  }
  return await callModal<VlmScoreResult>("MODAL_VLM_ENDPOINT", params);
}

// ─── Pipeline 3: WiLoR 手ポーズ推定 (= GPU 重処理、 手動トリガー) ──────────
// DATA_SPECS §4。 ぼかし済 MP4 の各フレームを WiLoR-mini に通し、 フレームごとの推定結果を
// processed/<signature_hash>/wilor.jsonl に書き出すだけ。 データセット組み立て (= 複数クリップを
// LeRobot v3 等にまとめる) はパイプライン外であり、 ここでは行わない。

export interface WilorRequest {
  /// 入力 signature_hash。 Modal は raw/<signature_hash>/rgb.mp4 を読み、
  /// processed/<signature_hash>/wilor.jsonl に書き出す。
  signatureHash: string;
}

export interface WilorResult {
  totalFrames: number;
  fps: number;
  /// hands detected per frame の平均
  handsDetectedAvg: number;
  durationMs: number;
  /// 出力した wilor.jsonl の R2 キー
  outputKey: string;
}

export async function callWilor(req: WilorRequest): Promise<WilorResult> {
  return await callModal<WilorResult>("MODAL_WILOR_ENDPOINT", {
    signature_hash: req.signatureHash,
  });
}
