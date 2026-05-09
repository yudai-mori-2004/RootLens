// SPDX-License-Identifier: Apache-2.0
//
// 共通アカウントを Address Lookup Table に登録して Tx サイズを圧縮する。
// fixtures.json の存在前提。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AddressLookupTableProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

import {
  MPL_CORE_PROGRAM_ID,
  MPL_BUBBLEGUM_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  findBubblegumTreeConfig,
  findLicenseTreeAuthority,
  findMplCoreCpiSigner,
} from "./issue-helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = resolve(__dirname, "fixtures.json");
const KEYS_DIR = resolve(__dirname, "../../keys");

function loadKeypair(filename: string): Keypair {
  const path = resolve(KEYS_DIR, filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function computeDesiredAddrs(fixtures: any): PublicKey[] {
  const programId = new PublicKey(fixtures.program_id);
  const configPda = new PublicKey(fixtures.config_pda);
  const usdcMint = new PublicKey(fixtures.usdc_mint);
  const licenseCollection = new PublicKey(fixtures.license_collection);
  const licenseMerkleTree = new PublicKey(fixtures.license_tree);
  const rootMerkleTree = new PublicKey(fixtures.root_tree);
  const licenseTreeConfig = findBubblegumTreeConfig(licenseMerkleTree);
  const licenseTreeAuthority = findLicenseTreeAuthority(programId, licenseMerkleTree);
  const mplCoreCpiSigner = findMplCoreCpiSigner();
  const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);
  return [
    SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    MPL_BUBBLEGUM_PROGRAM_ID,
    SPL_NOOP_PROGRAM_ID,
    MPL_CORE_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    configPda,
    usdcMint,
    licenseCollection,
    licenseMerkleTree,
    licenseTreeConfig,
    licenseTreeAuthority,
    rootMerkleTree,
    mplCoreCpiSigner,
    poolUsdc,
  ];
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES, "utf-8"));
  // 既に ALT があれば、addrs に未登録のものだけ extend (idempotent)
  if (fixtures.alt) {
    console.log(`ALT 既に存在: ${fixtures.alt}。差分のみ extend を試みる。`);
    const conn0 = new Connection("https://api.devnet.solana.com", "confirmed");
    const altAcc = (await conn0.getAddressLookupTable(new PublicKey(fixtures.alt))).value;
    const existing = new Set((altAcc?.state.addresses ?? []).map((a) => a.toBase58()));
    const desired = computeDesiredAddrs(fixtures);
    const toAdd = desired.filter((a) => !existing.has(a.toBase58()));
    if (toAdd.length === 0) {
      console.log("  すべて登録済。skip。");
      return;
    }
    console.log(`  追加: ${toAdd.map((a) => a.toBase58()).join(", ")}`);
    const deployer0 = loadKeypair("deployer.json");
    const ext = AddressLookupTableProgram.extendLookupTable({
      payer: deployer0.publicKey,
      authority: deployer0.publicKey,
      lookupTable: new PublicKey(fixtures.alt),
      addresses: toAdd,
    });
    const bh = await conn0.getLatestBlockhash("confirmed");
    const m = new TransactionMessage({
      payerKey: deployer0.publicKey,
      recentBlockhash: bh.blockhash,
      instructions: [ext],
    }).compileToV0Message();
    const t = new VersionedTransaction(m);
    t.sign([deployer0]);
    const sig = await conn0.sendTransaction(t);
    await conn0.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    console.log(`  extend sig: ${sig}`);
    return;
  }

  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const deployer = loadKeypair("deployer.json");

  const programId = new PublicKey(fixtures.program_id);
  const configPda = new PublicKey(fixtures.config_pda);
  const usdcMint = new PublicKey(fixtures.usdc_mint);
  const licenseCollection = new PublicKey(fixtures.license_collection);
  const licenseMerkleTree = new PublicKey(fixtures.license_tree);
  const rootMerkleTree = new PublicKey(fixtures.root_tree);

  const licenseTreeConfig = findBubblegumTreeConfig(licenseMerkleTree);
  const licenseTreeAuthority = findLicenseTreeAuthority(programId, licenseMerkleTree);
  const mplCoreCpiSigner = findMplCoreCpiSigner();
  const poolUsdc = getAssociatedTokenAddressSync(usdcMint, configPda, true);

  // ALT 作成 — finalized slot を使う必要あり (confirmed は ALT program 受付外)
  const slot = await conn.getSlot("finalized");
  const [createIx, altAddr] = AddressLookupTableProgram.createLookupTable({
    authority: deployer.publicKey,
    payer: deployer.publicKey,
    recentSlot: slot,
  });
  console.log(`ALT address: ${altAddr.toBase58()}`);

  // 登録するアカウント (program 系 + テストで再利用される public PDA / mint)
  const addrs: PublicKey[] = [
    SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
    MPL_BUBBLEGUM_PROGRAM_ID,
    SPL_NOOP_PROGRAM_ID,
    MPL_CORE_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    configPda,
    usdcMint,
    licenseCollection,
    licenseMerkleTree,
    licenseTreeConfig,
    licenseTreeAuthority,
    rootMerkleTree,
    mplCoreCpiSigner,
    poolUsdc,
  ];

  const extendIx = AddressLookupTableProgram.extendLookupTable({
    payer: deployer.publicKey,
    authority: deployer.publicKey,
    lookupTable: altAddr,
    addresses: addrs,
  });

  // 1 tx で create + extend
  const blockhash = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: deployer.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [createIx, extendIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([deployer]);
  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, ...blockhash }, "confirmed");
  console.log(`ALT create + extend sig: ${sig}`);

  // ALT が active になるまで slot 待つ (1 slot 経過するまで使えない)
  console.log("ALT が active になるのを待機...");
  const targetSlot = slot + 1;
  while ((await conn.getSlot("confirmed")) <= targetSlot) {
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log("ALT active");

  fixtures.alt = altAddr.toBase58();
  writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2) + "\n");
  console.log("fixtures.json に保存");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
