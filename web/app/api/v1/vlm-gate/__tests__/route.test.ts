/**
 * Unit H — POST /api/v1/vlm-gate route layer test。
 *
 * `evaluateTaskGateRaw` を vi.mock で差し替え、route の入力検証 / provider 解決 /
 * env からの key 取得 / error mapping を端的に audit する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { evalMock } = vi.hoisted(() => ({ evalMock: vi.fn() }));

vi.mock("@/lib/server/vlm-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/server/vlm-gate")>(
    "@/lib/server/vlm-gate",
  );
  return {
    ...actual,
    evaluateTaskGateRaw: evalMock,
  };
});

import { POST } from "../route";
import { VlmTimeoutError, VlmUpstreamError } from "@/lib/server/vlm-gate";

const FAKE_B64 = "/9j/4AAQ";

function buildReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/vlm-gate", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  evalMock.mockReset();
  // 全 provider 用 key を埋める。各テストで個別に消す
  process.env.ANTHROPIC_API_KEY = "test-claude";
  process.env.GEMINI_API_KEY = "test-gemini";
  process.env.OPENAI_API_KEY = "test-openai";
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

const HAPPY_RESULT = {
  score: 87,
  match: true,
  reason: "ok",
  rawText: '{"score":87,"match":true,"reason":"ok"}',
  latencyMs: 1234,
  promptTokens: 1024,
  candidatesTokens: 30,
};

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("POST /api/v1/vlm-gate — happy paths", () => {
  it("evaluates with default provider=claude", async () => {
    evalMock.mockResolvedValueOnce(HAPPY_RESULT);
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "fold",
        conditionText: "x",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      score: 87,
      match: true,
      reason: "ok",
      latencyMs: 1234,
      promptTokens: 1024,
      candidatesTokens: 30,
    });
    // rawText is internal — not exposed to client
    expect(body.rawText).toBeUndefined();
    expect(evalMock).toHaveBeenCalledTimes(1);
    const callArgs = evalMock.mock.calls[0][0];
    expect(callArgs.provider).toBe("claude");
    expect(callArgs.apiKey).toBe("test-claude");
    expect(callArgs.imageBase64).toBe(FAKE_B64);
    expect(callArgs.taskName).toBe("fold");
    expect(callArgs.conditionText).toBe("x");
  });

  it("supports explicit provider=gemini", async () => {
    evalMock.mockResolvedValueOnce(HAPPY_RESULT);
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
        provider: "gemini",
      }),
    );
    expect(res.status).toBe(200);
    const callArgs = evalMock.mock.calls[0][0];
    expect(callArgs.provider).toBe("gemini");
    expect(callArgs.apiKey).toBe("test-gemini");
  });

  it("supports custom model override", async () => {
    evalMock.mockResolvedValueOnce(HAPPY_RESULT);
    await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
        provider: "claude",
        model: "claude-opus-4",
      }),
    );
    expect(evalMock.mock.calls[0][0].model).toBe("claude-opus-4");
  });

  it("falls back to DEFAULT_MODEL_BY_PROVIDER when model omitted", async () => {
    evalMock.mockResolvedValueOnce(HAPPY_RESULT);
    await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(evalMock.mock.calls[0][0].model).toMatch(/^claude/);
  });
});

// ---------------------------------------------------------------------------
// Input validation (400)
// ---------------------------------------------------------------------------

describe("POST /api/v1/vlm-gate — input validation", () => {
  it("400 missing imageBase64", async () => {
    const res = await POST(buildReq({ taskName: "x", conditionText: "y" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/imageBase64/);
  });

  it("400 missing taskName", async () => {
    const res = await POST(
      buildReq({ imageBase64: FAKE_B64, conditionText: "y" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/taskName/);
  });

  it("400 missing conditionText", async () => {
    const res = await POST(buildReq({ imageBase64: FAKE_B64, taskName: "x" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/conditionText/);
  });

  it("400 taskName too long", async () => {
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "a".repeat(201),
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/taskName/);
  });

  it("400 conditionText too long", async () => {
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "a".repeat(1001),
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/conditionText/);
  });

  it("400 imageBase64 too long", async () => {
    const res = await POST(
      buildReq({
        imageBase64: "A".repeat(1_400_001),
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/imageBase64/);
  });

  it('400 imageBase64 with "data:" prefix', async () => {
    const res = await POST(
      buildReq({
        imageBase64: "data:image/jpeg;base64,/9j/4AAQ",
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/data:/);
  });

  it("400 imageBase64 with non-base64 chars", async () => {
    const res = await POST(
      buildReq({
        imageBase64: "!!! not base64 !!!",
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("400 unknown provider", async () => {
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
        provider: "magic",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/provider/);
  });

  it("400 malformed JSON body", async () => {
    const res = await POST(buildReq("{not json"));
    expect(res.status).toBe(400);
  });

  it("does not call evaluateTaskGateRaw on validation failure (fail fast)", async () => {
    await POST(buildReq({ taskName: "x", conditionText: "y" })); // no image
    expect(evalMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Server config errors (500)
// ---------------------------------------------------------------------------

describe("POST /api/v1/vlm-gate — server misconfig", () => {
  it("500 when ANTHROPIC_API_KEY missing for default provider", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/claude/);
    expect(evalMock).not.toHaveBeenCalled();
  });

  it("500 when GEMINI_API_KEY missing and provider=gemini specified", async () => {
    delete process.env.GEMINI_API_KEY;
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
        provider: "gemini",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/gemini/);
  });
});

// ---------------------------------------------------------------------------
// Upstream errors (502)
// ---------------------------------------------------------------------------

describe("POST /api/v1/vlm-gate — upstream errors", () => {
  it("502 on VlmUpstreamError 503", async () => {
    evalMock.mockRejectedValueOnce(new VlmUpstreamError(503, "overloaded"));
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/status=503/);
  });

  it("502 on VlmTimeoutError", async () => {
    evalMock.mockRejectedValueOnce(new VlmTimeoutError(25_000));
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/timeout/);
  });

  it("500 on unknown error from VLM logic", async () => {
    evalMock.mockRejectedValueOnce(new Error("parse oddity"));
    const res = await POST(
      buildReq({
        imageBase64: FAKE_B64,
        taskName: "x",
        conditionText: "y",
      }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/parse oddity/);
  });
});
