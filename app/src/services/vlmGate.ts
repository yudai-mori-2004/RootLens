/**
 * Unit H (SPECS §2.3 step 3 / step 6) — VLM gate の mobile SDK ラッパー。
 *
 * 役割: 画像 URI を受けて 480px JPEG q=0.7 に圧縮 → base64 化 →
 * `POST {SERVER_URL}/api/v1/vlm-gate` を叩いて `{score, match, reason}` を返す。
 *
 * Anthropic API key は **device には絶対に持たせない**。server endpoint が env から
 * 読む。本ラッパーが知っているのは server URL だけ。
 *
 * 使い方:
 *   import { evaluateTaskGate } from '@/services/vlmGate';
 *   const r = await evaluateTaskGate({
 *     imageUri,         // file:// または content://
 *     taskName: 'fold-laundry',
 *     conditionText: '畳まれていない洗濯物が広げてある',
 *   });
 *   if (r.match) { ... }
 */

import * as ImageManipulator from 'expo-image-manipulator';
import { config } from '../config';

export type VlmProvider = 'claude' | 'gemini' | 'openai';

export interface VlmGateRequest {
  imageUri: string;
  taskName: string;
  conditionText: string;
  /** dev / fallback 用。default は claude (server 側 default も同じ) */
  provider?: VlmProvider;
  /** dev / fallback 用。明示しなければ server が default model に倒す */
  model?: string;
  /** abort signal: タイムアウトやユーザーキャンセルを propagate する */
  signal?: AbortSignal;
  /** 上書き可能な endpoint (テスト用) */
  endpoint?: string;
}

export interface VlmGateResult {
  score: number;
  match: boolean;
  reason: string;
  latencyMs: number;
  promptTokens?: number;
  candidatesTokens?: number;
}

export class VlmGateError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`vlm-gate ${status}: ${body.slice(0, 200)}`);
    this.name = 'VlmGateError';
    this.status = status;
    this.body = body;
  }
}

/**
 * 画像 URI を server の VLM gate に投げて判定結果を受け取る。
 *
 * 失敗時:
 *   - 4xx / 5xx → VlmGateError (status, body)
 *   - network → 元の Error (TypeError 等) を re-throw
 *   - abort → AbortError (caller が signal を握っている前提)
 */
export async function evaluateTaskGate(req: VlmGateRequest): Promise<VlmGateResult> {
  // 1) 480px / JPEG q=0.7 に縮小して base64 化 (server-side の上限 1.4MB 以内に収まる)
  const manipulated = await ImageManipulator.manipulateAsync(
    req.imageUri,
    [{ resize: { width: 480 } }],
    {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    },
  );
  if (!manipulated.base64) {
    throw new Error('expo-image-manipulator returned no base64');
  }

  const endpoint = req.endpoint ?? config.vlmGateUrl;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      imageBase64: manipulated.base64,
      taskName: req.taskName,
      conditionText: req.conditionText,
      provider: req.provider,
      model: req.model,
    }),
    signal: req.signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new VlmGateError(res.status, body);
  }

  return (await res.json()) as VlmGateResult;
}
