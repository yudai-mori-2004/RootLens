// SPDX-License-Identifier: Apache-2.0
//
// 旧 License Bubblegum tree (deployer 所有) を捨て、program PDA を tree_creator に
// 持つ NEW License tree を program 内 ix 経由で作成する。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableProgram,
} from "@solana/web3.js";
// max_depth=5, max_buffer=8, canopy=0 の Bubblegum V2 tree alloc サイズ
// (既存 V2 tree の Length=1880 bytes より導出)
const MERKLE_TREE_SPACE_DEPTH5_BUF8 = 1880;

import {
  MPL_BUBBLEGUM_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  findBubblegumTreeConfig,
  findLicenseTreeAuthority,
} from "./issue-helpers";
import { anchorDiscriminator } from "./helpers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIXTURES = resolve(__dirname, "fixtures.json");
const KEYS_DIR = resolve(__dirname, "../../keys");

function loadKeypair(filename: string): Keypair {
  const path = resolve(KEYS_DIR, filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

const MAX_DEPTH = 5;
const MAX_BUFFER = 8;

function buildCreateLicenseTreeIx(
  programId: PublicKey,
  payer: PublicKey,
  merkleTree: PublicKey,
  treeConfig: PublicKey,
  licenseTreeAuthority: PublicKey
): TransactionInstruction {
  const data = Buffer.concat([
    anchorDiscriminator("create_license_tree"),
    Buffer.alloc(4), // max_depth (u32 LE)
    Buffer.alloc(4), // max_buffer_size (u32 LE)
  ]);
  data.writeUInt32LE(MAX_DEPTH, 8);
  data.writeUInt32LE(MAX_BUFFER, 12);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: treeConfig, isSigner: false, isWritable: true },
      { pubkey: licenseTreeAuthority, isSigner: false, isWritable: false },
      { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: MPL_BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

async function main() {
  const fixtures = JSON.parse(readFileSync(FIXTURES, "utf-8"));
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const deployer = loadKeypair("deployer.json");
  const programId = new PublicKey(fixtures.program_id);

  const merkleTreeKp = Keypair.generate();
  const merkleTree = merkleTreeKp.publicKey;
  const treeConfig = findBubblegumTreeConfig(merkleTree);
  const licenseTreeAuthority = findLicenseTreeAuthority(programId, merkleTree);

  console.log(`new License tree:        ${merkleTree.toBase58()}`);
  console.log(`new tree_config PDA:     ${treeConfig.toBase58()}`);
  console.log(`new tree_authority PDA:  ${licenseTreeAuthority.toBase58()}`);

  // 1. allocate merkle tree account (system createAccount with concurrent merkle tree size)
  const space = MERKLE_TREE_SPACE_DEPTH5_BUF8;
  const lamports = await conn.getMinimumBalanceForRentExemption(space);
  console.log(`merkle tree alloc:       ${space} bytes / ${lamports / 1e9} SOL`);

  const allocIx = SystemProgram.createAccount({
    fromPubkey: deployer.publicKey,
    newAccountPubkey: merkleTree,
    lamports,
    space,
    programId: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  });

  // 2. create_license_tree (CPI to Bubblegum CreateTreeConfigV2 with PDA seeds)
  const createIx = buildCreateLicenseTreeIx(
    programId,
    deployer.publicKey,
    merkleTree,
    treeConfig,
    licenseTreeAuthority
  );

  const blockhash = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: deployer.publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: [allocIx, createIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([deployer, merkleTreeKp]);
  const sig = await conn.sendTransaction(tx);
  await conn.confirmTransaction({ signature: sig, ...blockhash }, "confirmed");
  console.log(`create_license_tree sig: ${sig}`);

  // 3. fixtures.json 更新
  fixtures.license_tree = merkleTree.toBase58();
  fixtures.license_tree_authority = licenseTreeAuthority.toBase58();
  writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2) + "\n");
  console.log("fixtures.json 更新");

  // 4. ALT に新 tree + tree_config + tree_authority を extend
  const altAddr = new PublicKey(fixtures.alt);
  const altInfo = (await conn.getAddressLookupTable(altAddr)).value;
  const existing = new Set((altInfo?.state.addresses ?? []).map((a) => a.toBase58()));
  const toAdd = [merkleTree, treeConfig, licenseTreeAuthority].filter(
    (a) => !existing.has(a.toBase58())
  );
  if (toAdd.length > 0) {
    const extIx = AddressLookupTableProgram.extendLookupTable({
      payer: deployer.publicKey,
      authority: deployer.publicKey,
      lookupTable: altAddr,
      addresses: toAdd,
    });
    const bh = await conn.getLatestBlockhash("confirmed");
    const m = new TransactionMessage({
      payerKey: deployer.publicKey,
      recentBlockhash: bh.blockhash,
      instructions: [extIx],
    }).compileToV0Message();
    const t = new VersionedTransaction(m);
    t.sign([deployer]);
    const sig2 = await conn.sendTransaction(t);
    await conn.confirmTransaction({ signature: sig2, ...bh }, "confirmed");
    console.log(`ALT extend sig: ${sig2}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
