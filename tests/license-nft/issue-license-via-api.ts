// SPDX-License-Identifier: Apache-2.0
//
// 本番 `/api/v1/license/issue` を叩いて partial-signed tx を取得、 buyer keypair で
// 追加署名して devnet に broadcast する。 license type は CLI で複数指定可能、
// 指定したぶんだけ繰り返す。 broadcast 後に buyer 所有 License NFT の差分を出力する。
//
// 使い方:
//   BUYER_KEYPAIR_BASE58=<...> npx tsx issue-license-via-api.ts \
//     --root <root_asset_id> [--buyer <pubkey>] \
//     [--api https://rootlens.io/api/v1/license/issue] \
//     [--type commercial-v1 --type training-only-v1 ...]
//
// type を指定しないと commercial-v1 / training-only-v1 / redistribution-v1 の 3 本を
// 順番に発行する。

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK_PATH = resolve(__dirname, "../../network.json");
const network = JSON.parse(readFileSync(NETWORK_PATH, "utf-8"));
const LICENSE_COLLECTION: string = network.license_collection;

// catalog.ts (web/lib/license-nft/catalog.ts) と同じ URL を使う。 hash が変わったら
// ここも更新する (web/scripts/build-license-json.mjs を再実行 → URL を貼り替え)。
const LICENSE_URLS: Record<string, string> = {
  "commercial-v1":      "https://rootlens.io/licenses/commercial-v1/a45b97b96684e972516d2188a6fea2e9d37a6f50e6518bb2b23659b3948672dd.json",
  "non-commercial-v1":  "https://rootlens.io/licenses/non-commercial-v1/e541d00f60f973c34d5bff9d7665fab30ea09e5c6b3d4d7c8f25c147cee6cc4d.json",
  "training-only-v1":   "https://rootlens.io/licenses/training-only-v1/1aa2b7a6e6991944fe2125e272c2b6abf6f6206ed98b47ed589ff7ff5a1fc450.json",
  "redistribution-v1":  "https://rootlens.io/licenses/redistribution-v1/bdccbb8167d9a1ac8a994404104dacbaab613ead208e989070ac7137b7008944.json",
};

const DEFAULT_TYPES = ["commercial-v1", "training-only-v1", "redistribution-v1"];

interface Args {
  root: string;
  buyer?: string;
  api: string;
  types: string[];
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> & { types: string[] } = { types: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === "--root") { out.root = val; i++; }
    else if (flag === "--buyer") { out.buyer = val; i++; }
    else if (flag === "--api") { out.api = val; i++; }
    else if (flag === "--type") { out.types.push(val); i++; }
    else { console.error(`unknown flag: ${flag}`); process.exit(2); }
  }
  if (!out.root) { console.error("--root <root_asset_id> required"); process.exit(2); }
  if (out.types.length === 0) out.types = DEFAULT_TYPES.slice();
  for (const t of out.types) {
    if (!(t in LICENSE_URLS)) {
      console.error(`unknown license type: ${t} (allowed: ${Object.keys(LICENSE_URLS).join(", ")})`);
      process.exit(2);
    }
  }
  return {
    root: out.root,
    buyer: out.buyer,
    api: out.api ?? "https://rootlens.io/api/v1/license/issue",
    types: out.types,
  };
}

function loadBuyer(): Keypair {
  const b58 = process.env.BUYER_KEYPAIR_BASE58;
  if (!b58) {
    console.error("env BUYER_KEYPAIR_BASE58 required (base58-encoded 64-byte secret key)");
    process.exit(2);
  }
  return Keypair.fromSecretKey(bs58.decode(b58));
}

interface OwnedAsset { id: string }

async function ownedLicenseAssetIds(rpc: string, owner: string): Promise<Set<string>> {
  const r = await fetch(rpc, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: "1", method: "getAssetsByOwner",
      params: { ownerAddress: owner, page: 1, limit: 200 },
    }),
  });
  const j = (await r.json()) as { result?: { items?: Array<OwnedAsset & { grouping?: Array<{ group_value?: string }> }> } };
  const items = j.result?.items ?? [];
  return new Set(
    items
      .filter((i) => i.grouping?.some((g) => g.group_value === LICENSE_COLLECTION))
      .map((i) => i.id),
  );
}

async function main() {
  const args = parseArgs();
  const buyer = loadBuyer();
  const buyerPub = args.buyer ?? buyer.publicKey.toBase58();

  const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  const conn = new Connection(rpcUrl, "confirmed");

  const before = await ownedLicenseAssetIds(rpcUrl, buyerPub);
  console.log(`buyer ${buyerPub} owns ${before.size} License NFTs before`);

  for (const type of args.types) {
    console.log(`\n--- issuing ${type} ---`);
    const r = await fetch(args.api, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ rootAssetId: args.root, licenseUrl: LICENSE_URLS[type], buyerAddress: buyerPub }),
    });
    if (!r.ok) {
      console.error(`API error ${r.status}: ${await r.text()}`);
      process.exit(1);
    }
    const { partialSignedTx } = (await r.json()) as { partialSignedTx: string };
    const tx = VersionedTransaction.deserialize(Buffer.from(partialSignedTx, "base64"));
    tx.sign([buyer]);
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    console.log(`  sig: ${sig}`);
    const conf = await conn.confirmTransaction(sig, "confirmed");
    if (conf.value.err) {
      console.error(`  confirm err: ${JSON.stringify(conf.value.err)}`);
      process.exit(1);
    }
    console.log(`  confirmed`);
    await new Promise((res) => setTimeout(res, 4000));   // DAS catch up
  }

  await new Promise((res) => setTimeout(res, 6000));
  const after = await ownedLicenseAssetIds(rpcUrl, buyerPub);
  const fresh = [...after].filter((a) => !before.has(a));
  console.log(`\nbuyer now owns ${after.size} License NFTs (new: ${fresh.length})`);
  for (const id of fresh) console.log(`  ${id}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
