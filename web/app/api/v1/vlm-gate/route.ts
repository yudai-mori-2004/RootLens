/**
 * Unit H (SPECS §2.3 step 3 / step 6) — VLM gate endpoint。
 *
 * POST /api/v1/vlm-gate
 *
 * クライアントから (imageBase64, taskName, conditionText, provider?) を受け取り、
 * Claude (default) / Gemini / OpenAI で「画像が条件を満たすか」を判定する。
 * API key は server env からのみ読む。device には絶対 expose しない。
 */

import { NextRequest, NextResponse } from "next/server";
import {
  evaluateTaskGateRaw,
  DEFAULT_VLM_PROVIDER,
  DEFAULT_MODEL_BY_PROVIDER,
  VlmUpstreamError,
  VlmTimeoutError,
  type VlmProvider,
} from "@/lib/server/vlm-gate";

const ALLOWED_PROVIDERS: ReadonlyArray<VlmProvider> = ["claude", "gemini", "openai"];

const MAX_TASK_NAME_LEN = 200;
const MAX_CONDITION_LEN = 1000;
/** base64 上限。480px JPEG q=0.7 で 30-80KB が普通。1MB を超えるのは攻撃 or 送信側バグ */
const MAX_IMAGE_BASE64_LEN = 1_400_000;

interface VlmGateBody {
  imageBase64?: string;
  taskName?: string;
  conditionText?: string;
  provider?: string;
  /** dev escape — model を明示すれば DEFAULT_MODEL_BY_PROVIDER を override */
  model?: string;
}

const API_KEY_BY_PROVIDER: Record<VlmProvider, () => string | undefined> = {
  claude: () => process.env.ANTHROPIC_API_KEY,
  gemini: () => process.env.GEMINI_API_KEY,
  openai: () => process.env.OPENAI_API_KEY,
};

export async function POST(req: NextRequest) {
  let body: VlmGateBody;
  try {
    body = (await req.json()) as VlmGateBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { imageBase64, taskName, conditionText } = body;

  // --- 入力検証 (順番大事: cheap な field 検証から先に) ---
  if (!taskName || typeof taskName !== "string") {
    return NextResponse.json({ error: "taskName is required" }, { status: 400 });
  }
  if (taskName.length > MAX_TASK_NAME_LEN) {
    return NextResponse.json(
      { error: `taskName must be ≤ ${MAX_TASK_NAME_LEN} chars` },
      { status: 400 },
    );
  }
  if (!conditionText || typeof conditionText !== "string") {
    return NextResponse.json({ error: "conditionText is required" }, { status: 400 });
  }
  if (conditionText.length > MAX_CONDITION_LEN) {
    return NextResponse.json(
      { error: `conditionText must be ≤ ${MAX_CONDITION_LEN} chars` },
      { status: 400 },
    );
  }
  if (!imageBase64 || typeof imageBase64 !== "string") {
    return NextResponse.json({ error: "imageBase64 is required" }, { status: 400 });
  }
  if (imageBase64.length > MAX_IMAGE_BASE64_LEN) {
    return NextResponse.json(
      { error: `imageBase64 must be ≤ ${MAX_IMAGE_BASE64_LEN} chars (got ${imageBase64.length})` },
      { status: 400 },
    );
  }
  // base64 形式チェック (data: prefix は受け付けない)
  if (imageBase64.startsWith("data:")) {
    return NextResponse.json(
      { error: "imageBase64 must be raw base64, not a data: URI" },
      { status: 400 },
    );
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
    return NextResponse.json({ error: "imageBase64 contains non-base64 chars" }, { status: 400 });
  }

  // --- provider / model 解決 ---
  const provider: VlmProvider = (() => {
    if (!body.provider) return DEFAULT_VLM_PROVIDER;
    if (!ALLOWED_PROVIDERS.includes(body.provider as VlmProvider)) return null as never;
    return body.provider as VlmProvider;
  })();
  if (provider === (null as never)) {
    return NextResponse.json(
      { error: `provider must be one of ${ALLOWED_PROVIDERS.join(", ")}` },
      { status: 400 },
    );
  }
  const model = body.model || DEFAULT_MODEL_BY_PROVIDER[provider];

  const apiKey = API_KEY_BY_PROVIDER[provider]();
  if (!apiKey) {
    console.error(`[vlm-gate] missing API key for provider="${provider}"`);
    return NextResponse.json(
      { error: `server is not configured for provider="${provider}"` },
      { status: 500 },
    );
  }

  // --- 本処理 ---
  try {
    const result = await evaluateTaskGateRaw({
      provider,
      model,
      apiKey,
      imageBase64,
      taskName,
      conditionText,
    });
    return NextResponse.json({
      score: result.score,
      match: result.match,
      reason: result.reason,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      candidatesTokens: result.candidatesTokens,
    });
  } catch (e: unknown) {
    if (e instanceof VlmUpstreamError) {
      console.error(`[vlm-gate] upstream ${e.status}: ${e.body.slice(0, 200)}`);
      return NextResponse.json(
        { error: `vlm upstream error (status=${e.status})` },
        { status: 502 },
      );
    }
    if (e instanceof VlmTimeoutError) {
      console.error("[vlm-gate] timeout");
      return NextResponse.json({ error: "vlm timeout" }, { status: 502 });
    }
    console.error("[vlm-gate] unhandled:", e);
    const msg = e instanceof Error ? e.message : "internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
