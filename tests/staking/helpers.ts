// SPDX-License-Identifier: Apache-2.0
//
// Unit G — staking tests 用の共有ヘルパー。
//
// app/src/services/staking.ts の Node 版ミラー (mobile bundler から独立させて
// raw web3.js のみで動かす)。tests/license-nft/ の流儀に合わせる。

import {
  AccountMeta,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Program IDs (Bubblegum V2 経路)
// ============================================================================

export const MPL_BUBBLEGUM_PROGRAM_ID = new PublicKey(
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
);
export const MPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey(
  "mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW",
);
export const MPL_NOOP_PROGRAM_ID = new PublicKey(
  "mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3",
);

const DELEGATE_V2_DISCRIMINATOR = new Uint8Array([95, 87, 125, 140, 181, 131, 128, 227]);

// ============================================================================
// Fixtures (tests/staking/fixtures.json)
// ============================================================================

export interface StakingFixtures {
  /** license-nft のデプロイ済 program id (e2e で issue_license を呼ぶ用) */
  program_id: string;
  config_pda: string;
  title_core_collection: string;
  license_collection: string;
  usdc_mint: string;
  license_tree: string;
  license_tree_authority: string;
  /** Root NFT の Bubblegum tree (license-nft fixtures と同じものを参照) */
  root_tree: string;
  /** RootLens の cosign authority (= D の `issue_license` を共同署名する hot wallet) */
  cosign_authority: string;
  cosign_authority_secret: number[];
  /** staking テスト専用のリース leaf (license-nft の fixtures から借りる) */
  leaves: Array<{
    name: string;
    index: number;
    asset_id: string;
    owner: string;
    owner_secret: number[];
    /** mint 直後の delegate (= 元の delegate)。setup 時点の値、テスト中に変動する */
    initial_delegate: string;
  }>;
}

const FIXTURES_PATH = resolve(__dirname, "fixtures.json");

export function loadFixtures(): StakingFixtures {
  return JSON.parse(readFileSync(FIXTURES_PATH, "utf-8"));
}

export function loadKeypair(secret: number[]): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

/** keys/<filename> から keypair を読む (license-nft tests と同じ流儀) */
export function loadKeypairFromFile(filename: string): Keypair {
  const path = resolve(__dirname, "../../keys", filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

// ============================================================================
// PDA helpers
// ============================================================================

/** Bubblegum TreeConfig PDA: seed = [merkleTree.toBuffer()] */
export function findBubblegumTreeConfig(merkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

/**
 * Bubblegum cNFT asset ID PDA。
 *   seed = ["asset", merkleTree, leaf_index (u64 LE)]
 */
export function findLeafAssetId(merkleTree: PublicKey, leafIndex: number | bigint): PublicKey {
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigUInt64LE(BigInt(leafIndex), 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), merkleTree.toBuffer(), idxBuf],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

// ============================================================================
// DAS RPC (raw fetch)
// ============================================================================

interface DasGetAssetResult {
  id: string;
  ownership: { owner: string; delegate?: string | null };
  compression: {
    compressed: boolean;
    data_hash: string;
    creator_hash: string;
    asset_data_hash?: string | null;
    collection_hash?: string | null;
    flags?: number | null;
    leaf_id: number;
    seq: number;
    tree: string;
  };
}

interface DasGetAssetProofResult {
  root: string;
  proof: string[];
  node_index: number;
  leaf: string;
  tree_id: string;
}

export interface AssetWithProof {
  treeId: PublicKey;
  root: Uint8Array;
  dataHash: Uint8Array;
  creatorHash: Uint8Array;
  collectionHash: Uint8Array | null;
  assetDataHash: Uint8Array | null;
  flags: number | null;
  nonce: bigint;
  index: number;
  leafOwner: PublicKey;
  leafDelegate: PublicKey;
  proof: PublicKey[];
}

async function dasRpc<T>(url: string, method: string, params: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`DAS HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as
    | { result: T }
    | { error: { code: number; message: string } };
  if ("error" in body) {
    throw new Error(`DAS ${method}: ${body.error.message} (code ${body.error.code})`);
  }
  return body.result;
}

function base58Bytes32(b58: string): Uint8Array {
  return new PublicKey(b58).toBytes();
}

export async function fetchAssetWithProof(
  assetId: PublicKey,
  dasUrl: string,
): Promise<AssetWithProof> {
  const id = assetId.toBase58();
  const [asset, proof] = await Promise.all([
    dasRpc<DasGetAssetResult>(dasUrl, "getAsset", { id }),
    dasRpc<DasGetAssetProofResult>(dasUrl, "getAssetProof", { id }),
  ]);
  if (!asset.compression?.compressed) {
    throw new Error(`asset ${id} is not a compressed NFT`);
  }
  const leafOwner = new PublicKey(asset.ownership.owner);
  const leafDelegate = asset.ownership.delegate
    ? new PublicKey(asset.ownership.delegate)
    : leafOwner;
  return {
    treeId: new PublicKey(proof.tree_id),
    root: base58Bytes32(proof.root),
    dataHash: base58Bytes32(asset.compression.data_hash),
    creatorHash: base58Bytes32(asset.compression.creator_hash),
    collectionHash: asset.compression.collection_hash
      ? base58Bytes32(asset.compression.collection_hash)
      : null,
    assetDataHash: asset.compression.asset_data_hash
      ? base58Bytes32(asset.compression.asset_data_hash)
      : null,
    flags: typeof asset.compression.flags === "number" ? asset.compression.flags : null,
    nonce: BigInt(asset.compression.leaf_id),
    index: asset.compression.leaf_id,
    leafOwner,
    leafDelegate,
    proof: proof.proof.map((p) => new PublicKey(p)),
  };
}

/**
 * DAS は indexer の eventual consistency 都合で tx 確定後すぐは旧状態を返すことがある。
 * delegate field が期待値になるまで poll する。
 */
export async function waitUntilDelegate(
  assetId: PublicKey,
  expected: PublicKey,
  dasUrl: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<AssetWithProof> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 60000;
  const deadline = Date.now() + timeout;
  let last: AssetWithProof | null = null;
  while (Date.now() < deadline) {
    last = await fetchAssetWithProof(assetId, dasUrl);
    if (last.leafDelegate.equals(expected)) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `delegate did not become ${expected.toBase58()} within ${timeout}ms ` +
      `(last seen: ${last?.leafDelegate.toBase58()})`,
  );
}

// ============================================================================
// delegateV2 IX builder (raw)
// ============================================================================

export interface DelegateV2BuildArgs {
  payer: PublicKey;
  leafOwner: PublicKey;
  newLeafDelegate: PublicKey;
  asset: AssetWithProof;
}

export function buildDelegateV2Ix(args: DelegateV2BuildArgs): TransactionInstruction {
  const { payer, leafOwner, newLeafDelegate, asset } = args;
  const treeConfig = findBubblegumTreeConfig(asset.treeId);

  const keys: AccountMeta[] = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: leafOwner, isSigner: !payer.equals(leafOwner), isWritable: false },
    { pubkey: asset.leafDelegate, isSigner: false, isWritable: false }, // previousLeafDelegate
    { pubkey: newLeafDelegate, isSigner: false, isWritable: false },
    { pubkey: asset.treeId, isSigner: false, isWritable: true },
    { pubkey: MPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...asset.proof.map((p) => ({ pubkey: p, isSigner: false, isWritable: false })),
  ];

  const data = Buffer.concat([
    Buffer.from(DELEGATE_V2_DISCRIMINATOR),
    Buffer.from(asset.root),
    Buffer.from(asset.dataHash),
    Buffer.from(asset.creatorHash),
    encodeOption32(asset.collectionHash),
    encodeOption32(asset.assetDataHash),
    encodeOptionU8(asset.flags),
    encodeU64LE(asset.nonce),
    encodeU32LE(asset.index),
  ]);

  return new TransactionInstruction({
    programId: MPL_BUBBLEGUM_PROGRAM_ID,
    keys,
    data,
  });
}

function encodeOption32(v: Uint8Array | null): Buffer {
  if (!v) return Buffer.from([0]);
  if (v.length !== 32) throw new Error("option<[u8;32]> needs 32B");
  return Buffer.concat([Buffer.from([1]), Buffer.from(v)]);
}

function encodeOptionU8(v: number | null): Buffer {
  if (v === null) return Buffer.from([0]);
  return Buffer.from([1, v & 0xff]);
}

function encodeU64LE(v: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v, 0);
  return b;
}

function encodeU32LE(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}

// ============================================================================
// Send helpers
// ============================================================================

export async function sendIx(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  return await sendAndConfirmTransaction(conn, tx, signers, {
    commitment: "confirmed",
    skipPreflight: false,
  });
}

// ============================================================================
// RPC URL (env)
// ============================================================================

export function getDasUrl(): string {
  return (
    process.env.SOLANA_RPC_URL ??
    process.env.HELIUS_RPC_URL ??
    "https://api.devnet.solana.com" // 注: solana 公式 RPC は DAS 非対応。Helius 等を env で渡すこと
  );
}

export function getConnection(): Connection {
  return new Connection(getDasUrl(), "confirmed");
}
