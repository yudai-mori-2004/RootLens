/**
 * Unit F (SPECS §4.3) — r2.ts ヘルパー単体テスト。
 *
 * 検証対象:
 *   - normalizeContentHash: 形式バリエーションの吸収 + 不正入力の reject
 *   - normalizeExt: MIME / ext / 大文字 / paramつき の吸収
 *   - keyForContentHash: 各 kind / 各 ext の合成
 *   - objectExists: HEAD 200 / 404 / 403 の枝分かれ
 *
 * S3Client.send は vi.hoisted 経由で mock。実 R2 には接続しない。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// 環境変数は r2.ts の module load 時に読まれるので最優先で stub する
vi.hoisted(() => {
  process.env.R2_ACCOUNT_ID = "test-account";
  process.env.R2_ACCESS_KEY_ID = "test-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-secret";
  process.env.R2_PUBLIC_BUCKET = "rootlens-public-test";
  process.env.R2_PUBLIC_URL = "https://cdn.test";
});

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

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

import {
  HeadObjectCommand,
  type HeadObjectCommandInput,
} from "@aws-sdk/client-s3";

import {
  normalizeContentHash,
  normalizeExt,
  keyForContentHash,
  objectExists,
  publicUrlFor,
} from "../r2";

beforeEach(() => {
  sendMock.mockReset();
});

const HASH_LOWER = "a".repeat(64);
const HASH_UPPER = "A".repeat(64);

describe("normalizeContentHash", () => {
  it("returns lowercase 64-hex from already-normalized input", () => {
    expect(normalizeContentHash(HASH_LOWER)).toBe(HASH_LOWER);
  });
  it("strips 0x prefix (lowercase)", () => {
    expect(normalizeContentHash(`0x${HASH_LOWER}`)).toBe(HASH_LOWER);
  });
  it("strips 0X prefix (uppercase)", () => {
    expect(normalizeContentHash(`0X${HASH_UPPER}`)).toBe(HASH_LOWER);
  });
  it("converts uppercase to lowercase", () => {
    expect(normalizeContentHash(HASH_UPPER)).toBe(HASH_LOWER);
  });
  it("handles mixed case", () => {
    const mixed = "AbCdEf" + "0".repeat(58);
    expect(normalizeContentHash(mixed)).toBe(mixed.toLowerCase());
  });
  it("rejects length 63", () => {
    expect(() => normalizeContentHash("a".repeat(63))).toThrow(/64 hex/);
  });
  it("rejects length 65", () => {
    expect(() => normalizeContentHash("a".repeat(65))).toThrow(/64 hex/);
  });
  it("rejects non-hex character (g)", () => {
    expect(() => normalizeContentHash("g" + "a".repeat(63))).toThrow(/64 hex/);
  });
  it("rejects empty string", () => {
    expect(() => normalizeContentHash("")).toThrow(/64 hex/);
  });
  it("rejects bare 0x with no body", () => {
    expect(() => normalizeContentHash("0x")).toThrow(/64 hex/);
  });
  it("rejects non-string input", () => {
    expect(() => normalizeContentHash(undefined as unknown as string)).toThrow();
    expect(() => normalizeContentHash(null as unknown as string)).toThrow();
    expect(() => normalizeContentHash(123 as unknown as string)).toThrow();
  });
});

describe("normalizeExt", () => {
  it("passes through lowercase mp4", () => {
    expect(normalizeExt("mp4")).toBe("mp4");
  });
  it("lowercases MP4", () => {
    expect(normalizeExt("MP4")).toBe("mp4");
  });
  it("extracts ext from MIME video/mp4", () => {
    expect(normalizeExt("video/mp4")).toBe("mp4");
  });
  it("maps video/quicktime → mov", () => {
    expect(normalizeExt("video/quicktime")).toBe("mov");
  });
  it("maps image/jpeg → jpg", () => {
    expect(normalizeExt("image/jpeg")).toBe("jpg");
  });
  it("maps bare jpeg → jpg", () => {
    expect(normalizeExt("jpeg")).toBe("jpg");
  });
  it("strips MIME parameters", () => {
    expect(normalizeExt("video/mp4; codecs=avc1")).toBe("mp4");
  });
  it("rejects empty string", () => {
    expect(() => normalizeExt("")).toThrow();
  });
  it("rejects ext with non-alphanumeric (e.g. .mp4)", () => {
    expect(() => normalizeExt(".mp4")).toThrow(/unsupported/);
  });
  it("rejects ext with hyphen", () => {
    expect(() => normalizeExt("foo-bar")).toThrow(/unsupported/);
  });
});

describe("keyForContentHash", () => {
  it("media + mp4", () => {
    expect(keyForContentHash(HASH_LOWER, "media", "mp4")).toBe(
      `media/${HASH_LOWER}.mp4`,
    );
  });
  it("ogp + jpg", () => {
    expect(keyForContentHash(HASH_LOWER, "ogp", "jpg")).toBe(
      `ogp/${HASH_LOWER}.jpg`,
    );
  });
  it("content + jpg", () => {
    expect(keyForContentHash(HASH_LOWER, "content", "jpg")).toBe(
      `content/${HASH_LOWER}.jpg`,
    );
  });
  it("normalizes 0x-prefixed uppercase hash + MIME contentType in one call", () => {
    expect(keyForContentHash(`0x${HASH_UPPER}`, "media", "video/quicktime")).toBe(
      `media/${HASH_LOWER}.mov`,
    );
  });
  it("propagates invalid hash as Error", () => {
    expect(() => keyForContentHash("zz", "media", "mp4")).toThrow();
  });
  it("propagates invalid ext as Error", () => {
    expect(() => keyForContentHash(HASH_LOWER, "media", "")).toThrow();
  });
});

describe("publicUrlFor", () => {
  it("prefixes with R2_PUBLIC_URL", () => {
    expect(publicUrlFor(`media/${HASH_LOWER}.mp4`)).toBe(
      `https://cdn.test/media/${HASH_LOWER}.mp4`,
    );
  });
});

describe("objectExists (HEAD-based dedup probe)", () => {
  const KEY = `media/${HASH_LOWER}.mp4`;

  it("returns true on HEAD 200", async () => {
    sendMock.mockResolvedValueOnce({ $metadata: { httpStatusCode: 200 } });
    await expect(objectExists(KEY)).resolves.toBe(true);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call).toBeInstanceOf(HeadObjectCommand);
    const input = (call as HeadObjectCommand).input as HeadObjectCommandInput;
    expect(input.Bucket).toBe("rootlens-public-test");
    expect(input.Key).toBe(KEY);
  });

  it("returns false on NotFound (name)", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(objectExists(KEY)).resolves.toBe(false);
  });

  it("returns false on NoSuchKey (name)", async () => {
    sendMock.mockRejectedValueOnce({
      name: "NoSuchKey",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(objectExists(KEY)).resolves.toBe(false);
  });

  it("returns false when only httpStatusCode signals 404", async () => {
    sendMock.mockRejectedValueOnce({
      name: "SomeOtherError",
      $metadata: { httpStatusCode: 404 },
    });
    await expect(objectExists(KEY)).resolves.toBe(false);
  });

  it("throws on 403 (do NOT silently treat as not-existing)", async () => {
    sendMock.mockRejectedValueOnce({
      name: "Forbidden",
      $metadata: { httpStatusCode: 403 },
    });
    await expect(objectExists(KEY)).rejects.toBeTruthy();
  });

  it("throws on network error (no metadata)", async () => {
    sendMock.mockRejectedValueOnce(new Error("ECONNRESET"));
    await expect(objectExists(KEY)).rejects.toThrow(/ECONNRESET/);
  });
});
