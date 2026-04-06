/**
 * cNFT インデクサ初回バックフィル
 *
 * 使い方: cd web && npx next exec scripts/backfill.ts
 * または: cd web && npx tsx --env-file=.env scripts/backfill.ts
 */

import { pollAll } from "../lib/server/cnft-indexer";

async function main() {
  console.log("Starting cNFT backfill...");
  console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "set" : "MISSING");
  console.log("DAS_RPC:", process.env.NEXT_PUBLIC_DAS_RPC_URL ? "set" : "MISSING");

  const result = await pollAll();
  console.log("Backfill complete:", result);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
