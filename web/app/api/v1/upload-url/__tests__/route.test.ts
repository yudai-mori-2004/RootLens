/**
 * Unit F (SPECS §4.3) — POST /api/v1/upload-url の route 層テスト。
 *
 * 検証する API 契約:
 *   - 新規 content_hash → status="new" + uploadUrl + key + publicUrl
 *   - 既存 content_hash → status="exists" + key + publicUrl (uploadUrl 不在)
 *   - 不正入力は 400, R2 不到達は 500
 *
 * S3Client.send と getSignedUrl を vi.mock で差し替え、実 R2 / 実 KMS には接続しない。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.hoisted(() => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_PUBLIC_BUCKET = "rootlens-public-test";
  process.env.R2_PUBLIC_URL = "https://cdn.test";
});

const { sendMock, getSignedUrlMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  getSignedUrlMock: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", async () => {
  const actual =
    await vi.importActual<typeof import("@aws-sdk/client-s3")>("@aws-sdk/client-s3");
  return {
    ...actual,
    S3Client: class S3ClientMock {
      send = sendMock;
    },
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

import { POST } from "../route";

const HASH = "a".repeat(64);
const PRESIGNED_URL = "https://r2.test/media/presigned?sig=fake";

function buildReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/v1/upload-url", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
  getSignedUrlMock.mockResolvedValue(PRESIGNED_URL);
});

describe("POST /api/v1/upload-url — happy paths", () => {
  it("issues presign for a new content_hash (HEAD 404)", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });

    const res = await POST(
      buildReq({
        content_hash: HASH,
        kind: "media",
        contentType: "video/mp4",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "new",
      key: `media/${HASH}.mp4`,
      uploadUrl: PRESIGNED_URL,
      publicUrl: `https://cdn.test/media/${HASH}.mp4`,
    });
    expect(getSignedUrlMock).toHaveBeenCalledTimes(1);
  });

  it("returns exists status when HEAD 200 (no presign issued)", async () => {
    sendMock.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });

    const res = await POST(
      buildReq({
        content_hash: HASH,
        kind: "media",
        contentType: "video/mp4",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      status: "exists",
      key: `media/${HASH}.mp4`,
      publicUrl: `https://cdn.test/media/${HASH}.mp4`,
    });
    expect(body.uploadUrl).toBeUndefined();
    expect(getSignedUrlMock).not.toHaveBeenCalled();
  });

  it("normalizes 0x-prefixed uppercase hash + MIME quicktime to mov key", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });

    const res = await POST(
      buildReq({
        content_hash: `0x${HASH.toUpperCase()}`,
        kind: "media",
        contentType: "video/quicktime",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe(`media/${HASH}.mov`);
  });

  it("supports kind=ogp + image/jpeg", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    const res = await POST(
      buildReq({
        content_hash: HASH,
        kind: "ogp",
        contentType: "image/jpeg",
      }),
    );
    const body = await res.json();
    expect(body.status).toBe("new");
    expect(body.key).toBe(`ogp/${HASH}.jpg`);
  });

  it("dedup is consistent: 1st call new → 2nd call (now object exists) returns exists", async () => {
    // 1st: HEAD 404
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    const r1 = await POST(
      buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
    );
    expect((await r1.json()).status).toBe("new");

    // 2nd: HEAD 200 (object now uploaded)
    sendMock.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
    const r2 = await POST(
      buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
    );
    const r2Body = await r2.json();
    expect(r2Body.status).toBe("exists");
    expect(r2Body.uploadUrl).toBeUndefined();
  });

  it("race tolerance: 2 simultaneous HEAD-404 → both get new (last-writer-wins on R2)", async () => {
    // Both HEADs return 404 (race window)
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });

    const [r1, r2] = await Promise.all([
      POST(
        buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
      ),
      POST(
        buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
      ),
    ]);
    expect((await r1.json()).status).toBe("new");
    expect((await r2.json()).status).toBe("new");
    expect(getSignedUrlMock).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/v1/upload-url — input validation (400)", () => {
  it("rejects missing content_hash", async () => {
    const res = await POST(
      buildReq({ kind: "media", contentType: "video/mp4" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/content_hash/);
  });

  it("rejects missing contentType", async () => {
    const res = await POST(buildReq({ content_hash: HASH, kind: "media" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/contentType/);
  });

  it("rejects missing kind", async () => {
    const res = await POST(
      buildReq({ content_hash: HASH, contentType: "video/mp4" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/kind/);
  });

  it("rejects unknown kind", async () => {
    const res = await POST(
      buildReq({
        content_hash: HASH,
        kind: "unknown",
        contentType: "video/mp4",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/kind/);
  });

  it("rejects content_hash with wrong length", async () => {
    const res = await POST(
      buildReq({
        content_hash: "deadbeef",
        kind: "media",
        contentType: "video/mp4",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/64 hex/);
  });

  it("rejects content_hash with non-hex char", async () => {
    const res = await POST(
      buildReq({
        content_hash: "g".repeat(64),
        kind: "media",
        contentType: "video/mp4",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unsupported contentType", async () => {
    const res = await POST(
      buildReq({
        content_hash: HASH,
        kind: "media",
        contentType: "weird/.+",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON body", async () => {
    const res = await POST(buildReq("{this is not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON/);
  });

  it("does NOT call HEAD on input rejection (fail fast)", async () => {
    await POST(buildReq({ kind: "media", contentType: "video/mp4" })); // missing content_hash
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/upload-url — R2 errors (500)", () => {
  it("returns 500 when HEAD fails with 403", async () => {
    sendMock.mockRejectedValueOnce({
      name: "Forbidden",
      $metadata: { httpStatusCode: 403 },
    });
    const res = await POST(
      buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
    );
    expect(res.status).toBe(500);
  });

  it("returns 500 when HEAD throws network error", async () => {
    sendMock.mockRejectedValueOnce(new Error("ECONNRESET to R2"));
    const res = await POST(
      buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/ECONNRESET/);
  });

  it("returns 500 when getSignedUrl fails", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    getSignedUrlMock.mockRejectedValueOnce(new Error("KMS unavailable"));
    const res = await POST(
      buildReq({ content_hash: HASH, kind: "media", contentType: "video/mp4" }),
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/KMS/);
  });
});
