/**
 * レート制限のテスト
 */

import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, _resetStore, type RateLimitConfig } from "../rate-limit";

beforeEach(() => {
  _resetStore();
});

const testConfig: RateLimitConfig = { limit: 3, windowMs: 10_000 };

describe("checkRateLimit", () => {
  it("制限内のリクエストは許可される", () => {
    const r1 = checkRateLimit("test:1", testConfig);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = checkRateLimit("test:1", testConfig);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = checkRateLimit("test:1", testConfig);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("制限超過は拒否される", () => {
    checkRateLimit("test:2", testConfig);
    checkRateLimit("test:2", testConfig);
    checkRateLimit("test:2", testConfig);

    const r4 = checkRateLimit("test:2", testConfig);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it("異なるキーは独立してカウントされる", () => {
    checkRateLimit("a:1", testConfig);
    checkRateLimit("a:1", testConfig);
    checkRateLimit("a:1", testConfig);

    // a:1 は制限超過だが b:1 は初回
    const ra = checkRateLimit("a:1", testConfig);
    const rb = checkRateLimit("b:1", testConfig);

    expect(ra.allowed).toBe(false);
    expect(rb.allowed).toBe(true);
    expect(rb.remaining).toBe(2);
  });

  it("resetAt が未来の時刻を返す", () => {
    const now = Date.now();
    const r = checkRateLimit("test:3", testConfig);
    expect(r.resetAt).toBeGreaterThan(now);
    expect(r.resetAt).toBeLessThanOrEqual(now + testConfig.windowMs + 100);
  });

  it("ウィンドウ期限切れ後はカウントがリセットされる", () => {
    const shortConfig: RateLimitConfig = { limit: 1, windowMs: 1 }; // 1ms ウィンドウ

    const r1 = checkRateLimit("test:4", shortConfig);
    expect(r1.allowed).toBe(true);

    // 1ms 以上待つ（実際にはsetTimeoutなしでも次のtickで期限切れ）
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }

    const r2 = checkRateLimit("test:4", shortConfig);
    expect(r2.allowed).toBe(true); // リセットされている
  });
});
