/**
 * Unit F — 実 R2 への live 接続スモークテスト。
 *
 * デフォルトでは skip。`RUN_LIVE_R2=1 npx vitest run lib/server/__tests__/r2.live.test.ts`
 * で起動する。`.env` の R2_* を直接読んで実 Cloudflare R2 に接続する。
 *
 * シーケンス:
 *   1. HEAD test-key → 404
 *   2. presigned PUT 発行 → curl で 1 byte payload を PUT
 *   3. HEAD test-key → 200
 *   4. deletePublic でクリーンアップ
 *   5. HEAD test-key → 404
 *
 * これが通れば「presign / PUT / HEAD / DELETE」の R2 round-trip が全部生きている。
 */

import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// .env を hand-roll で読む (next の env loader を経由しない、dotenv も使わない)
function loadEnv(path: string) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      const k = m[1];
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    // .env が無くても CI 等で env が直接渡っていれば ok
  }
}
loadEnv(resolve(__dirname, "../../../.env"));

const RUN = process.env.RUN_LIVE_R2 === "1";
const describeLive = RUN ? describe : describe.skip;

// 動的 import — env を読み込んでからモジュールを load する
async function loadR2() {
  return await import("../r2");
}

describeLive("R2 live round-trip (RUN_LIVE_R2=1)", () => {
  // テスト専用 content_hash (実 R2 を汚さないよう "test-" prefix が分かる固定値)
  // hash 64 文字: t4 + ts (ms hex 13 桁) + 49 個の 0
  const ts = Date.now().toString(16);
  const HASH = ("t4" + ts + "0".repeat(64 - 2 - ts.length)).toLowerCase();
  // ↑ "t" は hex 範囲外。テスト用 valid hash に差し替える
  const SAFE_HASH = ("e2" + ts + "0".repeat(64 - 2 - ts.length)).toLowerCase();

  it("HEAD → presign+PUT → HEAD → DELETE → HEAD round-trip", async () => {
    const r2 = await loadR2();
    const key = r2.keyForContentHash(SAFE_HASH, "media", "mp4");

    console.log(`[r2-live] using key: ${key}`);

    // 1) initial HEAD → must be 404
    const exists0 = await r2.objectExists(key);
    expect(exists0).toBe(false);

    // 2) presign + PUT
    const uploadUrl = await r2.createPresignedPutUrl(key, "video/mp4", 60);
    expect(uploadUrl).toMatch(/^https?:\/\//);

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      body: new Uint8Array([0xff, 0xd8, 0xff]), // dummy 3-byte payload
      headers: { "content-type": "video/mp4" },
    });
    expect(putRes.ok).toBe(true);

    // 3) HEAD → must be 200
    const exists1 = await r2.objectExists(key);
    expect(exists1).toBe(true);

    // 4) cleanup
    await r2.deletePublic(key);

    // 5) final HEAD → must be 404 again
    const exists2 = await r2.objectExists(key);
    expect(exists2).toBe(false);
  }, 30_000);
});
