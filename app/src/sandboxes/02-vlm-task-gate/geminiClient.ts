// Gemini API client (Google AI Studio 経由)。
//
// 設計:
//   - Sandbox 検証フェーズなので、API key と model ID は画面 UI から受け取って
//     AsyncStorage に保存する形。本実装フェーズで .env / Vertex AI に移行する想定。
//   - structured output は responseSchema で強制 (match/confidence/reason)。
//   - エラー時は throw、呼び出し側で UI に出す。
//
// 参照: https://ai.google.dev/gemini-api/docs/structured-output
//        https://ai.google.dev/gemini-api/docs/robotics-overview
//        https://ai.google.dev/gemini-api/docs/vision

import * as FileSystem from 'expo-file-system';

export interface TaskGateRequest {
  apiKey: string;
  model: string;            // 例: "gemini-robotics-er-1.6", "gemini-2.5-flash"
  imageUri: string;         // file:// URI (CameraView.takePictureAsync の uri)
  taskName: string;
  conditionText: string;    // 「両手と散らかった洗濯物が見える」等
  thinkingBudgetTokens?: number;  // -1=auto, 0=off, >0=指定 (model 依存)
}

export interface TaskGateResult {
  match: boolean;
  confidence: number;       // 0..1
  reason: string;
  rawText: string;          // モデル原文 (デバッグ用)
  latencyMs: number;        // network round-trip
  promptTokens?: number;
  candidatesTokens?: number;
}

const SYSTEM_PROMPT = `あなたは家事タスクの一人称視点 (egocentric) スナップショットを評価する判定者です。
ユーザーが指定したタスクと条件に対して、画像が条件を満たしているかを厳密に判定してください。
判定は match (bool), confidence (0..1 float), reason (簡潔な日本語) の 3 フィールドで返します。`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    match: { type: 'BOOLEAN' },
    confidence: { type: 'NUMBER' },
    reason: { type: 'STRING' },
  },
  required: ['match', 'confidence', 'reason'],
} as const;

export async function evaluateTaskGate(req: TaskGateRequest): Promise<TaskGateResult> {
  const base64 = await FileSystem.readAsStringAsync(req.imageUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const userText =
    `タスク: ${req.taskName}\n` +
    `条件: ${req.conditionText}\n\n` +
    `この一人称視点スナップショットは上記条件を満たしますか?`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'image/jpeg', data: base64 } },
          { text: userText },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  if (typeof req.thinkingBudgetTokens === 'number') {
    // gemini-2.5+ で利用可能
    (body.generationConfig as Record<string, unknown>).thinkingConfig = {
      thinkingBudget: req.thinkingBudgetTokens,
    };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent` +
    `?key=${encodeURIComponent(req.apiKey)}`;

  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - t0;

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`Gemini API ${res.status}: ${text}`);
  }

  const json = (await res.json()) as GeminiResponse;
  const candidate = json.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text ?? '';

  let parsed: { match: boolean; confidence: number; reason: string };
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${rawText.slice(0, 200)}`);
  }

  return {
    match: !!parsed.match,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    rawText,
    latencyMs,
    promptTokens: json.usageMetadata?.promptTokenCount,
    candidatesTokens: json.usageMetadata?.candidatesTokenCount,
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}
