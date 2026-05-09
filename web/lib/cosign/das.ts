// SPDX-License-Identifier: Apache-2.0
//
// Helius / Triton DAS (Digital Asset Standard) JSON-RPC クライアント。
// Bubblegum cNFT (Root NFT) の getAsset / getAssetProof を引いて
// issue_license IX に必要な leaf 情報を返す。
//
// raw fetch のみ。UMI / @metaplex-foundation/* は使わない (server bundle を軽く保つ)。

import { PublicKey } from "@solana/web3.js";

export interface AssetWithProof {
  /** leaf root (32B Merkle root) */
  root: Uint8Array;
  /** leaf data_hash (32B) */
  dataHash: Uint8Array;
  /** leaf creator_hash (32B) */
  creatorHash: Uint8Array;
  /** leaf asset_data_hash (V2 only。null なら 32B zero) */
  assetDataHash: Uint8Array;
  /** leaf flags (V2 only。null なら 0) */
  flags: number;
  /** leaf nonce (== leaf id within tree) */
  nonce: bigint;
  /** leaf 配置 index (proof verify 用) */
  index: number;
  /** leaf owner (= staker) */
  leafOwner: PublicKey;
  /** leaf delegate (RootLens の delegate keypair public part と一致するはず) */
  leafDelegate: PublicKey;
  /** Merkle proof として渡す sibling pubkey 配列 */
  proof: PublicKey[];
  /** root の merkle tree pubkey */
  treeId: PublicKey;
}

interface DasJsonRpcOk<T> { jsonrpc: "2.0"; id: number; result: T }
interface DasJsonRpcErr { jsonrpc: "2.0"; id: number; error: { code: number; message: string } }

async function rpc<T>(url: string, method: string, params: object): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`DAS HTTP ${res.status} ${res.statusText}`);
  const body = (await res.json()) as DasJsonRpcOk<T> | DasJsonRpcErr;
  if ("error" in body) {
    throw new Error(`DAS ${method} error: ${body.error.message} (code ${body.error.code})`);
  }
  return body.result;
}

/** DAS getAsset のうち issue_license IX 構築に必要な部分だけ抜く型 */
interface GetAssetResult {
  id: string;
  ownership: { owner: string; delegate?: string | null };
  compression: {
    compressed: boolean;
    eligible: boolean;
    data_hash: string;
    creator_hash: string;
    asset_data_hash?: string | null;
    flags?: number | null;
    leaf_id: number;
    seq: number;
    tree: string;
    /** 通常 null (leaf は asset_data に格納される)。フィールド存在自体に依存しない */
    [k: string]: unknown;
  };
}

interface GetAssetProofResult {
  root: string;          // base58
  proof: string[];       // base58
  node_index: number;
  leaf: string;          // base58 (leaf hash)
  tree_id: string;       // base58
}

/** 1 リクエストで getAssetWithProof 相当を取得 (ホスト側に getAssetWithProof が無い場合の汎用フォールバック) */
export async function fetchAssetWithProof(
  rpcUrl: string,
  assetIdBase58: string,
): Promise<AssetWithProof> {
  // 並列で叩く
  const [asset, proof] = await Promise.all([
    rpc<GetAssetResult>(rpcUrl, "getAsset", { id: assetIdBase58 }),
    rpc<GetAssetProofResult>(rpcUrl, "getAssetProof", { id: assetIdBase58 }),
  ]);

  if (!asset.compression?.compressed) {
    throw new Error(`asset ${assetIdBase58} is not a compressed NFT`);
  }
  if (!asset.ownership?.delegate) {
    throw new Error(`asset ${assetIdBase58} has no delegate set — not stake-active`);
  }

  return {
    root: base58ToBytes(proof.root),
    dataHash: base58ToBytes(asset.compression.data_hash),
    creatorHash: base58ToBytes(asset.compression.creator_hash),
    assetDataHash: asset.compression.asset_data_hash
      ? base58ToBytes(asset.compression.asset_data_hash)
      : new Uint8Array(32),
    flags: asset.compression.flags ?? 0,
    nonce: BigInt(asset.compression.leaf_id),
    index: asset.compression.leaf_id, // V2 では leaf_id == index
    leafOwner: new PublicKey(asset.ownership.owner),
    leafDelegate: new PublicKey(asset.ownership.delegate),
    proof: proof.proof.map((p) => new PublicKey(p)),
    treeId: new PublicKey(proof.tree_id),
  };
}

function base58ToBytes(b58: string): Uint8Array {
  // PublicKey は base58 を decode できるので 32B なら流用可能。32B 以外 (proof root etc.) は手書き
  // ここは proof.root と data_hash で 32B が来る前提。それ以外を渡すと throw する。
  const pk = new PublicKey(b58); // 32B 検証 + decode
  return pk.toBytes();
}
