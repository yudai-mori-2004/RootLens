/**
 * cNFT インデクサ バックフィル / 穴埋め
 *
 * 全件走査モードで実行し、インデックス漏れを補完する。
 * 使い方: cd web && npx tsx --env-file=.env scripts/backfill.ts
 */

import { pollAll } from "../lib/server/cnft-indexer";

async function main() {
  console.log("Starting cNFT backfill (full scan)...");
  const result = await pollAll(true);
  console.log("Backfill complete:", result);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
