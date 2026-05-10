// SPDX-License-Identifier: Apache-2.0
//
// Unit G — Staking client (Bubblegum delegate wrapper).
// SPECS_JA §4.2 / §4.5。Root NFT (cNFT) の delegate を RootLens の cosign authority
// に設定する/owner 自身に戻す。Bubblegum の `delegateV2` 命令を使う。
//
// 設計:
//   - 既存 services (`titleProtocol.ts`) と同じく @solana/web3.js を直叩き。
//     UMI / mpl-bubblegum SDK は使わない (RN bundle を軽く保つ + bundler 依存複雑化を避ける)
//   - DAS RPC (getAsset / getAssetProof) を raw fetch で叩いて leaf 情報と proof を取る
//   - `delegateV2` の wire format は kinobi 自動生成版 (mpl-bubblegum SDK) を参照して手書き
//
// 関連:
//   - `web/lib/cosign/das.ts` — Unit E (server) 側に同じ DAS read が既存
//   - `tests/staking/` — devnet 上で G→D の e2e (issue_license が通る/落ちる) を検証

import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountMeta,
} from '@solana/web3.js';

// ============================================================================
// Program IDs (Bubblegum V2 経路)
// ============================================================================

export const MPL_BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
);

/** Bubblegum V2 trees の所有 program。spl-account-compression ではない */
const MPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey(
  'mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW',
);

const MPL_NOOP_PROGRAM_ID = new PublicKey(
  'mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3',
);

/** kinobi 自動生成の delegateV2 instruction discriminator */
const DELEGATE_V2_DISCRIMINATOR = new Uint8Array([95, 87, 125, 140, 181, 131, 128, 227]);

// ============================================================================
// DAS RPC (raw fetch, no SDK)
// ============================================================================

interface DasGetAssetResult {
  id: string;
  ownership: { owner: string; delegate?: string | null };
  compression: {
    compressed: boolean;
    data_hash: string;        // base58
    creator_hash: string;     // base58
    asset_data_hash?: string | null;  // base58 (V2 only)
    collection_hash?: string | null;  // base58 (V2 only)
    flags?: number | null;            // u8 (V2 only)
    leaf_id: number;
    seq: number;
    tree: string;
  };
}

interface DasGetAssetProofResult {
  root: string;       // base58
  proof: string[];    // base58 (sibling pubkeys)
  node_index: number;
  leaf: string;       // base58 (leaf hash)
  tree_id: string;    // base58
}

/** asset + proof を 1 トリップで取得した正規化形 */
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`DAS HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as
    | { jsonrpc: '2.0'; id: number; result: T }
    | { jsonrpc: '2.0'; id: number; error: { code: number; message: string } };
  if ('error' in body) {
    throw new Error(`DAS ${method}: ${body.error.message} (code ${body.error.code})`);
  }
  return body.result;
}

/** base58 string が常に 32B として decode 可能 (PublicKey 構造) であることを利用 */
function base58Bytes32(b58: string): Uint8Array {
  return new PublicKey(b58).toBytes();
}

export async function fetchAssetWithProof(
  rootAssetId: PublicKey,
  dasUrl: string,
): Promise<AssetWithProof> {
  const id = rootAssetId.toBase58();
  const [asset, proof] = await Promise.all([
    dasRpc<DasGetAssetResult>(dasUrl, 'getAsset', { id }),
    dasRpc<DasGetAssetProofResult>(dasUrl, 'getAssetProof', { id }),
  ]);
  if (!asset.compression?.compressed) {
    throw new Error(`asset ${id} is not a compressed NFT`);
  }
  // delegate 未設定 (= owner 自身) の場合 DAS は null を返す → owner にフォールバック
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
    flags: typeof asset.compression.flags === 'number' ? asset.compression.flags : null,
    nonce: BigInt(asset.compression.leaf_id),
    index: asset.compression.leaf_id, // V2: leaf_id == index
    leafOwner,
    leafDelegate,
    proof: proof.proof.map((p) => new PublicKey(p)),
  };
}

// ============================================================================
// Public API
// ============================================================================

export interface DelegateStatus {
  /** leaf.delegate (DAS の ownership.delegate)。未設定なら owner と同一値が返る */
  delegate: PublicKey;
  /** leaf.owner */
  owner: PublicKey;
  /** delegate === target かつ delegate !== owner なら true (target に staking 中) */
  isStakedTo: (target: PublicKey) => boolean;
  /** delegate === owner なら true (un-staked) */
  isUnstaked: () => boolean;
}

/**
 * 直近 staking 状態を返す。staking ボタン UI 表示判定に使う。
 *
 * @param rootAssetId  Root NFT の asset id
 * @param dasUrl       DAS 対応の RPC endpoint (devnet では Solana 公式 api.devnet.solana.com、mainnet では helius/triton/quicknode 等)
 */
export async function getDelegateStatus(
  rootAssetId: PublicKey,
  dasUrl: string,
): Promise<DelegateStatus> {
  const ap = await fetchAssetWithProof(rootAssetId, dasUrl);
  const ownerEqualsDelegate = ap.leafOwner.equals(ap.leafDelegate);
  return {
    delegate: ap.leafDelegate,
    owner: ap.leafOwner,
    isStakedTo: (target) => ap.leafDelegate.equals(target) && !ownerEqualsDelegate,
    isUnstaked: () => ownerEqualsDelegate,
  };
}

/**
 * Staking IX (= Bubblegum delegateV2 with newDelegate = cosignAuthority)。
 *
 * 撮影者 (Root NFT owner) の wallet が tx に sign する必要あり (payer + leafOwner)。
 * RPC コール 1 往復 (getAsset + getAssetProof) で proof + leaf info を取得する。
 *
 * @returns 1 個の TransactionInstruction (caller が Transaction にラップして broadcast)
 */
export async function buildStakeIx(args: {
  rootAssetId: PublicKey;
  currentOwner: PublicKey;
  cosignAuthority: PublicKey;
  dasUrl: string;
}): Promise<TransactionInstruction> {
  const ap = await fetchAssetWithProof(args.rootAssetId, args.dasUrl);
  if (!ap.leafOwner.equals(args.currentOwner)) {
    throw new Error(
      `currentOwner ${args.currentOwner.toBase58()} != leaf.owner ${ap.leafOwner.toBase58()}`,
    );
  }
  return buildDelegateV2Ix({
    payer: args.currentOwner,
    leafOwner: args.currentOwner,
    previousLeafDelegate: ap.leafDelegate,
    newLeafDelegate: args.cosignAuthority,
    asset: ap,
  });
}

/**
 * Unstaking IX (= Bubblegum delegateV2 with newDelegate = currentOwner = leaf.owner)。
 *
 * Bubblegum は「delegate を unset する」命令を持たない。
 * 解除 = delegate field を owner 自身に戻す と定義する (§4.5)。
 * 以後の D の `issue_license` は co-signer != leaf.delegate で `DelegateMismatch` で失敗する。
 */
export async function buildUnstakeIx(args: {
  rootAssetId: PublicKey;
  currentOwner: PublicKey;
  dasUrl: string;
}): Promise<TransactionInstruction> {
  const ap = await fetchAssetWithProof(args.rootAssetId, args.dasUrl);
  if (!ap.leafOwner.equals(args.currentOwner)) {
    throw new Error(
      `currentOwner ${args.currentOwner.toBase58()} != leaf.owner ${ap.leafOwner.toBase58()}`,
    );
  }
  return buildDelegateV2Ix({
    payer: args.currentOwner,
    leafOwner: args.currentOwner,
    previousLeafDelegate: ap.leafDelegate,
    newLeafDelegate: args.currentOwner, // ← owner 自身に戻す
    asset: ap,
  });
}

// ============================================================================
// IX builder (delegateV2 wire format)
// ============================================================================

function buildDelegateV2Ix(args: {
  payer: PublicKey;
  leafOwner: PublicKey;
  previousLeafDelegate: PublicKey;
  newLeafDelegate: PublicKey;
  asset: AssetWithProof;
}): TransactionInstruction {
  const { payer, leafOwner, previousLeafDelegate, newLeafDelegate, asset } = args;

  // Tree authority PDA: Bubblegum の TreeConfig は seed = [merkleTree.toBuffer()]
  const [treeConfig] = PublicKey.findProgramAddressSync(
    [asset.treeId.toBuffer()],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );

  // Account order (mpl-bubblegum kinobi delegateV2 と一致):
  //   0: treeConfig          (writable)
  //   1: payer               (writable, signer)
  //   2: leafOwner           (signer, NOT writable; defaults to payer)
  //   3: previousLeafDelegate (NOT writable)
  //   4: newLeafDelegate     (NOT writable)
  //   5: merkleTree          (writable)
  //   6: logWrapper (Noop)   (NOT writable)
  //   7: compressionProgram  (NOT writable)
  //   8: systemProgram       (NOT writable)
  //   9..N: proof (NOT writable)
  const keys: AccountMeta[] = [
    { pubkey: treeConfig, isSigner: false, isWritable: true },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: leafOwner, isSigner: !payer.equals(leafOwner), isWritable: false },
    { pubkey: previousLeafDelegate, isSigner: false, isWritable: false },
    { pubkey: newLeafDelegate, isSigner: false, isWritable: false },
    { pubkey: asset.treeId, isSigner: false, isWritable: true },
    { pubkey: MPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ...asset.proof.map((p) => ({ pubkey: p, isSigner: false, isWritable: false })),
  ];

  const data = serializeDelegateV2Args(asset);

  return new TransactionInstruction({
    programId: MPL_BUBBLEGUM_PROGRAM_ID,
    keys,
    data,
  });
}

/**
 * delegateV2 instruction data の serialize:
 *   [8B discriminator]
 *   [32B root][32B dataHash][32B creatorHash]
 *   [Option<32B> collectionHash]   = 1B tag + 32B?
 *   [Option<32B> assetDataHash]    = 1B tag + 32B?
 *   [Option<u8>  flags]            = 1B tag + 1B?
 *   [u64 LE nonce][u32 LE index]
 */
function serializeDelegateV2Args(asset: AssetWithProof): Buffer {
  const parts: Buffer[] = [];
  parts.push(Buffer.from(DELEGATE_V2_DISCRIMINATOR));
  parts.push(Buffer.from(asset.root));
  parts.push(Buffer.from(asset.dataHash));
  parts.push(Buffer.from(asset.creatorHash));
  parts.push(serializeOption32(asset.collectionHash));
  parts.push(serializeOption32(asset.assetDataHash));
  parts.push(serializeOptionU8(asset.flags));
  parts.push(serializeU64LE(asset.nonce));
  parts.push(serializeU32LE(asset.index));
  return Buffer.concat(parts);
}

function serializeOption32(v: Uint8Array | null): Buffer {
  if (!v) return Buffer.from([0]);
  if (v.length !== 32) throw new Error('option 32B value with wrong length');
  return Buffer.concat([Buffer.from([1]), Buffer.from(v)]);
}

function serializeOptionU8(v: number | null): Buffer {
  if (v === null) return Buffer.from([0]);
  return Buffer.from([1, v & 0xff]);
}

function serializeU64LE(v: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(v, 0);
  return buf;
}

function serializeU32LE(v: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(v >>> 0, 0);
  return buf;
}
