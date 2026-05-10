import * as ImageManipulator from 'expo-image-manipulator';

// VLM client (provider 抽象 + 画像縮小 + プロンプト改善)。
//
// なぜ provider 抽象か:
//   - gemini-2.5-flash-lite は high-demand 503 と「常識 override」(条件文に書いてあっても
//     『散らかっている = 悪い』で reject する) で本用途に弱い
//   - claude-sonnet-4.6 / 4.7 は instruction following が強く、日本語条件文を厳守してくれる
//   - openai gpt-4o は速い + 構造化出力 (json_schema) ネイティブ
//   → 3 provider 切替可能にし、default を Claude にする
//
// 画像縮小:
//   - 720×1280 quality 0.8 (~150-400KB) → 480 幅 quality 0.7 (~30-80KB)
//   - VQA に高解像度不要、転送 + 推論 latency 大幅削減
//
// プロンプト改善:
//   - 「条件文に書かれた要素が画像にあるかだけ判定。一般常識で『散らかっている = 悪い』等の
//     override をするな」を system に明示
//   - 構造化出力: match (bool), confidence (0..1), reason (簡潔な日本語)

export type VlmProvider = 'gemini' | 'claude' | 'openai';

export const DEFAULT_VLM_PROVIDER: VlmProvider = 'claude';

export const DEFAULT_MODEL_BY_PROVIDER: Record<VlmProvider, string> = {
  gemini: 'gemini-2.5-flash-lite',
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
};

export interface VlmRequest {
  provider: VlmProvider;
  model: string;
  apiKey: string;
  imageUri: string;
  taskName: string;
  conditionText: string;
}

export interface VlmResult {
  /** quality score 0..100 (how well condition is satisfied; 100 = perfect) */
  score: number;
  /** true if score >= 70 (passed threshold) */
  match: boolean;
  /** one concise sentence explaining the score */
  reason: string;
  rawText: string;
  latencyMs: number;
  promptTokens?: number;
  candidatesTokens?: number;
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

const RESPONSE_SCHEMA_GEMINI = {
  type: 'OBJECT',
  properties: {
    score: { type: 'INTEGER' },
    match: { type: 'BOOLEAN' },
    reason: { type: 'STRING' },
  },
  required: ['score', 'match', 'reason'],
} as const;

// MARK: - 共通前処理

async function preprocessImage(uri: string): Promise<{ base64: string; sizeBytes: number }> {
  const result = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 480 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!result.base64) {
    throw new Error('ImageManipulator returned no base64');
  }
  return { base64: result.base64, sizeBytes: Math.floor(result.base64.length * 0.75) };
}

function buildUserText(taskName: string, conditionText: string): string {
  return (
    `Task: ${taskName}\n` +
    `Condition: ${conditionText}\n\n` +
    `Does this first-person snapshot satisfy the condition?\n` +
    `Check each element of the condition one by one and reply with JSON.`
  );
}

function parseJsonResponse(rawText: string): { score: number; match: boolean; reason: string } {
  const cleaned = (() => {
    const m = rawText.match(/\{[\s\S]*\}/);
    return m ? m[0] : rawText;
  })();
  const parsed = JSON.parse(cleaned);
  const score = typeof parsed.score === 'number' ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 0;
  return {
    score,
    match: typeof parsed.match === 'boolean' ? parsed.match : score >= 70,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
  };
}

// MARK: - Top-level dispatcher

export async function evaluateTaskGate(req: VlmRequest): Promise<VlmResult> {
  if (!req.apiKey) throw new Error(`API key 未設定 (${req.provider})`);
  const { base64 } = await preprocessImage(req.imageUri);
  switch (req.provider) {
    case 'gemini': return callGemini(req, base64);
    case 'claude': return callClaude(req, base64);
    case 'openai': return callOpenAI(req, base64);
  }
}

// MARK: - Gemini (generativelanguage.googleapis.com v1beta)

async function callGemini(req: VlmRequest, base64: string): Promise<VlmResult> {
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: 'image/jpeg', data: base64 } },
        { text: buildUserText(req.taskName, req.conditionText) },
      ],
    }],
    generationConfig: {
      temperature: 0.0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA_GEMINI,
    },
  };
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent` +
    `?key=${encodeURIComponent(req.apiKey)}`;

  const { res, latencyMs } = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const candidate = json?.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text ?? '';
  const parsed = parseJsonResponse(rawText);
  return {
    ...parsed,
    rawText,
    latencyMs,
    promptTokens: json?.usageMetadata?.promptTokenCount,
    candidatesTokens: json?.usageMetadata?.candidatesTokenCount,
  };
}

// MARK: - Claude (api.anthropic.com /v1/messages)
// 注意: Anthropic-API は CORS / browser direct call を拒否しがち。React Native の fetch は
// User-Agent が node 系で受理される (実機検証で通った前提)。本番は backend proxy 経由必須。

async function callClaude(req: VlmRequest, base64: string): Promise<VlmResult> {
  const body = {
    model: req.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        { type: 'text', text: buildUserText(req.taskName, req.conditionText) },
      ],
    }],
  };

  const { res, latencyMs } = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      // Allow direct browser-style calls. RN の fetch は CORS preflight 不要だが、
      // Anthropic 側が browser-origin でも受けるためのヘッダ。
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const rawText = (json?.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('') as string;
  const parsed = parseJsonResponse(rawText);
  return {
    ...parsed,
    rawText,
    latencyMs,
    promptTokens: json?.usage?.input_tokens,
    candidatesTokens: json?.usage?.output_tokens,
  };
}

// MARK: - OpenAI (api.openai.com /v1/chat/completions, JSON schema mode)

async function callOpenAI(req: VlmRequest, base64: string): Promise<VlmResult> {
  const body = {
    model: req.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
          { type: 'text', text: buildUserText(req.taskName, req.conditionText) },
        ],
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'task_gate_judgment',
        schema: {
          type: 'object',
          properties: {
            score: { type: 'integer', minimum: 0, maximum: 100 },
            match: { type: 'boolean' },
            reason: { type: 'string' },
          },
          required: ['score', 'match', 'reason'],
          additionalProperties: false,
        },
        strict: true,
      },
    },
    temperature: 0.0,
  };

  const { res, latencyMs } = await fetchWithRetry('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${req.apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const rawText = json?.choices?.[0]?.message?.content ?? '';
  const parsed = parseJsonResponse(rawText);
  return {
    ...parsed,
    rawText,
    latencyMs,
    promptTokens: json?.usage?.prompt_tokens,
    candidatesTokens: json?.usage?.completion_tokens,
  };
}

// MARK: - Common HTTP helper

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
): Promise<{ res: Response; latencyMs: number }> {
  const t0 = Date.now();
  let res: Response | null = null;
  let lastErr: string | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    res = await fetch(url, init);
    if (res.ok) {
      return { res, latencyMs: Date.now() - t0 };
    }
    lastErr = await res.text().catch(() => '<no body>');
    // 503 (overloaded) / 429 (rate limit) / 529 (anthropic overloaded) のみ retry
    if (![429, 503, 529].includes(res.status)) break;
    if (attempt < maxAttempts - 1) {
      const delay = 600 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(`VLM API ${res?.status ?? 'no response'}: ${lastErr ?? 'unknown'}`);
}

// MARK: - Backwards-compat alias (旧 geminiClient.ts を使う既存呼出向け)

/** @deprecated use evaluateTaskGate with provider */
export interface TaskGateRequest {
  apiKey: string;
  model: string;
  imageUri: string;
  taskName: string;
  conditionText: string;
  thinkingBudgetTokens?: number;
}
/** @deprecated use VlmResult */
export type TaskGateResult = VlmResult;
