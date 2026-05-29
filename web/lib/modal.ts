// Modal クラウド関数を Node.js から HTTP 経由で呼ぶラッパ。
//
// Pipeline 2 (= 自動): 前処理 (ラベリング) + 多軸採点を1関数で実行
//   - MODAL_PIPELINE2_ENDPOINT     rootlens-pipeline2 (= preprocess + scoring、 軸ベクトルを返す)
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

import type { QualityAxis } from "@/shared/api-types";

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

// ─── Pipeline 2: 前処理 (ラベリング) + 多軸採点 ───────────────────────
// rootlens-pipeline2 は対称な2ステージ (preprocess → scoring) を stateless に実行し、
// 軸ごと 0-100 の品質ベクトル (= 合計なし) を返す。 詳細は DATA_SPECS §3。

export interface Pipeline2Result {
  signatureHash: string;
  preprocessed: Array<{ name: string; artifacts: string[]; meta: Record<string, unknown> }>;
  /// 軸名 → {axis, score 0-100, method, breakdown}。 合成しない (= 重みは買い手)。
  scores: Record<string, QualityAxis>;
}

/// Pipeline 2 を実行する。 preprocess / score を省略すると既定 (= labeling / 全採点軸) を走らせる。
export async function callPipeline2(opts: {
  signatureHash: string;
  preprocess?: string;   // csv (既定 labeling)
  score?: string;        // csv (既定 video_technical,motion_content,label_quality)
  labeler?: string;      // labeling 前処理が使う Labeler (既定 gemini-video-dense)
}): Promise<Pipeline2Result> {
  const params: Record<string, string> = { signature_hash: opts.signatureHash };
  if (opts.preprocess) params.preprocess = opts.preprocess;
  if (opts.score) params.score = opts.score;
  if (opts.labeler) params.labeler = opts.labeler;
  return await callModal<Pipeline2Result>("MODAL_PIPELINE2_ENDPOINT", params);
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
