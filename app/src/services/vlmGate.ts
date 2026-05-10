/**
 * Unit H (SPECS §2.3 step 3 / step 6) — VLM gate (device 直叩き版)。
 *
 * デバイスから直接 Anthropic API を叩いて画像と条件文の match を判定する。
 * server proxy (web/app/api/v1/vlm-gate) は機能としては残してあるが、本ラッパーは使わない。
 *
 * 鍵: process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY (bundle に inline される)。
 *     bundle 解析で漏洩可能なので **dev/demo 限定**。production では server proxy 戻し or
 *     ephemeral token 化が必要。
 *
 * 使い方:
 *   import { evaluateTaskGate } from '@/services/vlmGate';
 *   const r = await evaluateTaskGate({
 *     imageUri,         // file:// or content://
 *     taskName: 'fold-laundry',
 *     conditionText: 'Unfolded laundry is gathered in a single pile, and both hands are visible in frame.',
 *   });
 *   if (r.match) { ... }
 */

import * as ImageManipulator from 'expo-image-manipulator';

const ENV = process.env as Record<string, string | undefined>;
const ANTHROPIC_API_KEY = ENV.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

// 旧 server-route とは互換のため型を維持。provider/model field は無視 (Claude 固定)。
export type VlmProvider = 'claude' | 'gemini' | 'openai';

export interface VlmGateRequest {
  imageUri: string;
  taskName: string;
  conditionText: string;
  /** 互換性維持。直叩き版では Claude 固定 */
  provider?: VlmProvider;
  /** 上書き可。default は claude-sonnet-4-6 */
  model?: string;
  signal?: AbortSignal;
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

const SYSTEM_PROMPT = `You are a judge evaluating egocentric (first-person) snapshots of household chores.

Return a quality score 0–100 measuring how well the image satisfies the condition:
- 90–100: every element clearly satisfied, picture-perfect
- 70–89: satisfied with minor caveats
- 40–69: partially satisfied — some elements present, others missing
- 0–39: not satisfied or unrelated

Rules you MUST follow:
1. Score ONLY whether the elements listed in the condition appear in the image
2. Do NOT apply general aesthetic preferences (tidy / clean / beautiful) when the condition does not ask for them
3. If the condition says "messy", "unfolded", "disheveled", a messy/unfolded image SATISFIES the condition (high score)
4. If the condition says "both hands visible in frame", check only that two hands are visible, regardless of pose
5. Take each phrase in the condition as a literal checklist item; do not interpret intent

Respond with JSON ONLY (no prose, no markdown), exactly these 3 fields:
- score: integer 0..100
- match: boolean (true iff score >= 70)
- reason: string — ONE concise sentence in the same language as the condition`;

function buildUserText(taskName: string, conditionText: string): string {
  return (
    `Task: ${taskName}\n` +
    `Condition: ${conditionText}\n\n` +
    `Does this first-person snapshot satisfy the condition?\n` +
    `Check each element of the condition one by one and reply with JSON.`
  );
}

function parseJsonResponse(rawText: string): { score: number; match: boolean; reason: string } {
  const m = rawText.match(/\{[\s\S]*\}/);
  const cleaned = m ? m[0] : rawText;
  const parsed = JSON.parse(cleaned);
  const score =
    typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0;
  return {
    score,
    match: typeof parsed.match === 'boolean' ? parsed.match : score >= 70,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

/**
 * 画像 URI を Claude に直接送って判定結果を受け取る。
 *
 * 失敗時:
 *   - 4xx / 5xx → VlmGateError
 *   - network → 元の Error を re-throw
 *   - abort → AbortError
 */
export async function evaluateTaskGate(req: VlmGateRequest): Promise<VlmGateResult> {
  if (!ANTHROPIC_API_KEY) {
    throw new Error('EXPO_PUBLIC_ANTHROPIC_API_KEY 未設定');
  }

  // 1) 480px / JPEG q=0.7 に縮小して base64 化 (Claude の入力サイズに優しい)
  const manipulated = await ImageManipulator.manipulateAsync(
    req.imageUri,
    [{ resize: { width: 480 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!manipulated.base64) {
    throw new Error('expo-image-manipulator returned no base64');
  }

  // 2) Anthropic /v1/messages を直叩き
  const t0 = Date.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      // RN fetch は CORS preflight 不要だが、Anthropic 側が browser-origin リクエストを
      // 受けるための明示。app/.env の API key を bundle に inline している前提。
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: req.model ?? DEFAULT_CLAUDE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: manipulated.base64 },
            },
            { type: 'text', text: buildUserText(req.taskName, req.conditionText) },
          ],
        },
      ],
    }),
    signal: req.signal,
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new VlmGateError(res.status, body);
  }

  const json = await res.json();
  const rawText = (json?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('') as string;
  const parsed = parseJsonResponse(rawText);
  return {
    ...parsed,
    latencyMs,
    promptTokens: json?.usage?.input_tokens,
    candidatesTokens: json?.usage?.output_tokens,
  };
}
