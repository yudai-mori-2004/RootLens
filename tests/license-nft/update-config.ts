// SPDX-License-Identifier: Apache-2.0
//
// `update_config` IX を CLI から叩く運用ツール。 admin keypair (= keys/dev/solana/authority.json)
// で署名する。 値を Some / None で指定可能、 渡したフィールドのみ更新する。
//
// 使い方:
//   npx tsx update-config.ts \
//     [--root-collection <pubkey>] \
//     [--usdc-mint <pubkey>] \
//     [--staker-bps <0..10000>] \
//     [--delegate-bps <0..10000>] \
//     [--authority <pubkey>]
//
// IX の引数順は programs/license-nft/src/lib.rs::update_config と一致 (helpers.ts と
// 同じ encoder)。

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildUpdateConfigIx } from "./helpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NETWORK_PATH = resolve(__dirname, "../../network.json");
const network = JSON.parse(readFileSync(NETWORK_PATH, "utf-8"));
const PROGRAM_ID = new PublicKey(network.program_id);
const CONFIG_PDA = new PublicKey(network.config_pda);

interface Args {
  rootCollection?: PublicKey;
  usdcMint?: PublicKey;
  stakerBps?: number;
  delegateBps?: number;
  authority?: PublicKey;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const val = argv[i + 1];
    if (flag === "--root-collection") { out.rootCollection = new PublicKey(val); i++; }
    else if (flag === "--usdc-mint") { out.usdcMint = new PublicKey(val); i++; }
    else if (flag === "--staker-bps") { out.stakerBps = Number(val); i++; }
    else if (flag === "--delegate-bps") { out.delegateBps = Number(val); i++; }
    else if (flag === "--authority") { out.authority = new PublicKey(val); i++; }
    else { console.error(`unknown flag: ${flag}`); process.exit(2); }
  }
  if (
    !out.rootCollection && !out.usdcMint && out.stakerBps === undefined
    && out.delegateBps === undefined && !out.authority
  ) {
    console.error("at least one --root-collection / --usdc-mint / --staker-bps / --delegate-bps / --authority required");
    process.exit(2);
  }
  return out;
}

function loadAuthority(): Keypair {
  const path = resolve(__dirname, "../../keys/dev/solana/authority.json");
  const arr = JSON.parse(readFileSync(path, "utf-8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

function decodeConfig(buf: Buffer) {
  return {
    authority: bs58.encode(buf.subarray(8, 40)),
    rootNftCollection: bs58.encode(buf.subarray(40, 72)),
    licenseCollection: bs58.encode(buf.subarray(72, 104)),
    usdcMint: bs58.encode(buf.subarray(104, 136)),
    stakerBps: buf.readUInt16LE(136),
    delegateBps: buf.readUInt16LE(138),
  };
}

async function main() {
  const args = parseArgs();
  const authority = loadAuthority();
  const conn = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com", "confirmed");

  const ix = buildUpdateConfigIx(PROGRAM_ID, CONFIG_PDA, authority.publicKey, {
    newAuthority: args.authority ?? null,
    newStakerBps: args.stakerBps ?? null,
    newDelegateBps: args.delegateBps ?? null,
    newRootNftCollection: args.rootCollection ?? null,
    newUsdcMint: args.usdcMint ?? null,
  });

  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(ix), [authority], { commitment: "confirmed" });
  console.log(`update_config sig: ${sig}`);

  const info = await conn.getAccountInfo(CONFIG_PDA, "confirmed");
  if (!info) { console.error("config PDA not found after update"); process.exit(1); }
  const cfg = decodeConfig(info.data);
  console.log(`authority           : ${cfg.authority}`);
  console.log(`root_nft_collection : ${cfg.rootNftCollection}`);
  console.log(`license_collection  : ${cfg.licenseCollection}`);
  console.log(`usdc_mint           : ${cfg.usdcMint}`);
  console.log(`staker_bps          : ${cfg.stakerBps}`);
  console.log(`delegate_bps        : ${cfg.delegateBps}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
