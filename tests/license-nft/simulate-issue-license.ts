// SPDX-License-Identifier: Apache-2.0
//
// `/api/v1/license/issue` を叩いて partial-signed tx を取得、 buyer 署名を足してから
// `simulateTransaction` (broadcast せず) でオンチェーン挙動を確認する。 issue tx の
// dry-run / debug 用途。 broadcast は伴わない (= 成功させても License NFT は発行
// されない、 USDC も動かない)。
//
// 使い方:
//   BUYER_KEYPAIR_BASE58=<...> npx tsx simulate-issue-license.ts \
//     --root <root_asset_id> --license-url <licenseUrl> [--buyer <pubkey>] \
//     [--api https://rootlens.io/api/v1/license/issue]

import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

interface Args {
  root: string;
  licenseUrl: string;
  buyer?: string;
  api: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Partial<Args> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === "--root") { out.root = val; i++; }
    else if (flag === "--license-url") { out.licenseUrl = val; i++; }
    else if (flag === "--buyer") { out.buyer = val; i++; }
    else if (flag === "--api") { out.api = val; i++; }
    else { console.error(`unknown flag: ${flag}`); process.exit(2); }
  }
  if (!out.root || !out.licenseUrl) {
    console.error("--root and --license-url required");
    process.exit(2);
  }
  return {
    root: out.root,
    licenseUrl: out.licenseUrl,
    buyer: out.buyer,
    api: out.api ?? "https://rootlens.io/api/v1/license/issue",
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

async function main() {
  const args = parseArgs();
  const buyer = loadBuyer();
  const buyerPub = args.buyer ?? buyer.publicKey.toBase58();

  const apiRes = await fetch(args.api, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootAssetId: args.root, licenseUrl: args.licenseUrl, buyerAddress: buyerPub }),
  });
  console.log(`api: HTTP ${apiRes.status}`);
  if (!apiRes.ok) {
    console.error(await apiRes.text());
    process.exit(1);
  }
  const { partialSignedTx } = (await apiRes.json()) as { partialSignedTx: string };
  const txBytes = Buffer.from(partialSignedTx, "base64");
  console.log(`tx size: ${txBytes.length} bytes (v0 limit 1232)`);

  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([buyer]);

  const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log("\n=== simulate result ===");
  console.log(`err: ${JSON.stringify(sim.value.err)}`);
  console.log("\n=== logs ===");
  for (const l of sim.value.logs ?? []) console.log(l);
}

main().catch((e) => { console.error(e); process.exit(1); });
