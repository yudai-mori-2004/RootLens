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

import type { AutoCategory } from "@/shared/api-types";

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

// ─── Pipeline 2: ラベリング (= dense narration) ───────────────────────
// 品質スコアリング (旧 layer1 metadata / layer2 frame-sampling / layer3 VLM 採点) は
// この flow から分離した。 スコアリングはタスク定義依存の別レイヤーで後段に被せる (= 現状未実装)。

/// 2026-05-29: layer3 はラベリング専任に分離 (= 採点しない)。 返値はラベル結果のみ。
/// 品質スコアリングはタスク定義依存の別フローで後段に行う (= ここでは扱わない)。
export interface Layer3LabelResult {
  /// 要約キーワードから派生した粗カテゴリ (= marketplace フィルタの目安)
  autoCategory: AutoCategory;
  autoCategoryConfidence: number;
  /// セグメント被覆から算出した観測統計 (= 手作業していない時間割合。 採点ではない)
  idleRatio: number;
  /// クリップ全体の 1 文要約
  summary: string;
  /// dense narration セグメント (= semantic.jsonl の内容と対応)
  frameLabels: Array<{
    frameIdx: number;
    tsSec: number;
    description: string;
  }>;
}

/// Pipeline 2 ラベリング層 (= layer3 Modal, gemini-video-dense 既定)。 採点はしない。
export async function callLayer3Labeling(opts: {
  signatureHash: string;
  labeler?: string;
}): Promise<Layer3LabelResult> {
  const params: Record<string, string> = { signature_hash: opts.signatureHash };
  if (opts.labeler) params.labeler = opts.labeler;
  return await callModal<Layer3LabelResult>("MODAL_VLM_ENDPOINT", params);
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
