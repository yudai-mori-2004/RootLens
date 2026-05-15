// SPDX-License-Identifier: Apache-2.0
//
// SPECS_JA §5.5.3 第三者検証スクリプト。 入力は License NFT の asset id 1 個以上、
// 出力は 4 step (collection 所属 / leaf.uri 取得 / Layer 1 root_mint / Layer 2 hash)
// の PASS / FAIL 一覧。 chain と RootLens 公開 hosting への HTTP fetch のみ、 副作用なし。
//
// task 14 の `verification-script` 受入基準に対応する成果物。
//
// 使い方:
//   npx tsx verify-license-chain.ts <license_nft_asset_id> [<asset_id> ...]
//
// step 5-6 (Root NFT 側 → TP collection / content_hash) は Extension cNFT
// (`rootlens-license-v1` WASM) が未実装 (task 14 別項目) のため本スクリプトでは
// 検証しない。

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK_PATH = resolve(__dirname, "../../network.json");
const network = JSON.parse(readFileSync(NETWORK_PATH, "utf-8"));

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const LICENSE_COLLECTION: string = network.license_collection;

interface Result { id: string; pass: boolean; err?: string }

async function rpc<T>(method: string, params: object): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "1", method, params }),
  });
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

function fmt(label: string, ok: boolean, detail = ""): boolean {
  const tag = ok ? "  PASS" : "  FAIL";
  console.log(`${tag}  ${label}${detail ? "  -- " + detail : ""}`);
  return ok;
}

async function verifyOne(assetId: string): Promise<boolean> {
  console.log(`\n========== ${assetId} ==========`);
  let allPass = true;

  // step 1: getAsset, collection check
  const asset = await rpc<{
    grouping?: Array<{ group_value?: string }>;
    content?: { json_uri?: string };
  }>("getAsset", { id: assetId });
  const groups = (asset.grouping ?? []).map((g) => g.group_value).filter((v): v is string => !!v);
  allPass = fmt(
    "step 1: collection == License Collection",
    groups.includes(LICENSE_COLLECTION),
    `groups=${JSON.stringify(groups)}`,
  ) && allPass;

  // step 2: extract URI
  const uri = asset.content?.json_uri;
  const uriOk = typeof uri === "string" && uri.length > 0;
  allPass = fmt("step 2: leaf.uri present", uriOk, uriOk ? uri! : "(empty)") && allPass;
  if (!uriOk) return allPass;

  // step 3: parse ?root_mint=
  let rootMint: string | null = null;
  try {
    rootMint = new URL(uri!).searchParams.get("root_mint");
  } catch { /* ignore */ }
  const rootOk = !!rootMint && rootMint.length >= 32 && rootMint.length <= 44;
  allPass = fmt("step 3: ?root_mint= parsed (Layer 1)", rootOk, rootMint ?? "(missing)") && allPass;

  // step 4: hash check
  const baseUrl = uri!.split("?")[0];
  const m = baseUrl.match(/\/licenses\/[^/]+\/([0-9a-f]{64})\.json$/);
  if (!m) {
    return fmt("step 4: URL hash format", false, `URL doesn't match /licenses/<type>/<sha256>.json -- ${baseUrl}`) && allPass;
  }
  const urlHash = m[1];
  const fetched = await fetch(baseUrl);
  if (!fetched.ok) {
    return fmt("step 4: license JSON fetch", false, `HTTP ${fetched.status} for ${baseUrl}`) && allPass;
  }
  const bodyBytes = Buffer.from(await fetched.arrayBuffer());
  const computedHash = createHash("sha256").update(bodyBytes).digest("hex");
  return fmt(
    "step 4: sha256(JSON bytes) == URL hash (Layer 2)",
    computedHash === urlHash,
    computedHash === urlHash ? urlHash : `URL=${urlHash} computed=${computedHash}`,
  ) && allPass;
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("usage: npx tsx verify-license-chain.ts <license_nft_asset_id> [...]");
    process.exit(1);
  }
  const results: Result[] = [];
  for (const id of ids) {
    try {
      results.push({ id, pass: await verifyOne(id) });
    } catch (e) {
      console.error(`${id}: ${(e as Error).message}`);
      results.push({ id, pass: false, err: (e as Error).message });
    }
  }
  console.log("\n========== summary ==========");
  for (const r of results) {
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.id}${r.err ? "  (" + r.err + ")" : ""}`);
  }
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main();
