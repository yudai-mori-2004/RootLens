// SPDX-License-Identifier: Apache-2.0
//
// issue_license tx を組み立てて delegate 署名を付与する orchestration 層。
//
// 依存はすべて引数で受ける (Connection, fetchAssetWithProof, Signer)。
// → unit test で mock 注入できる。

import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildIssueLicenseIx,
  decodeConfig,
  findBubblegumTreeConfig,
  findLicenseTreeAuthority,
  findMplCoreCpiSigner,
  findUserRevenuePda,
} from "./program";
import type { AssetWithProof } from "./das";
import type { DelegateSigner } from "./signer";

// ===== ATA derivation (avoid @solana/spl-token dep) ======================

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
): PublicKey {
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes())) {
    throw new Error(`owner ${owner.toBase58()} is off-curve (PDA?). pass allowOwnerOffCurve=true if intended`);
  }
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

// ===== build + sign =====================================================

export interface BuildTxParams {
  /** Solana RPC connection (config 取得用) */
  connection: Connection;
  /** DAS で proof を引く関数 (test では mock 可能) */
  fetchProof: (rootAssetId: string) => Promise<AssetWithProof>;
  /** delegate 署名者 */
  signer: DelegateSigner;

  /** License NFT program ID */
  programId: PublicKey;
  /** Config PDA (network.json から) */
  configPda: PublicKey;
  /** RootLens 専用の License Merkle Tree pubkey */
  licenseMerkleTree: PublicKey;

  /** リクエストパラメータ */
  rootAssetId: string;       // base58
  licenseUrl: string;        // catalog から取得した正規 URL
  buyerAddress: string;      // base58
  price: bigint;             // catalog price (u64)
  licenseName: string;       // メタデータ name (例: "RootLens License — commercial-v1")
}

export interface BuildTxResult {
  /** delegate のみ署名済の v0 tx (base64) */
  partialSignedTxBase64: string;
  /** デバッグ用: 構築に使った blockhash */
  recentBlockhash: string;
}

/**
 * issue_license の `asset_data_hash` フィールドが leaf に焼かれているなら proof.assetDataHash を使う。
 * §5.5.3 の URI append 方式のときは zero (32B) でよい — contract がそれを許容する前提。
 */
function buildIxFromProof(
  programId: PublicKey,
  proof: AssetWithProof,
  buyer: PublicKey,
  delegate: PublicKey,
  rootCollection: PublicKey,
  licenseCollection: PublicKey,
  licenseMerkleTree: PublicKey,
  usdcMint: PublicKey,
  configPda: PublicKey,
  licenseUrl: string,
  licenseName: string,
  price: bigint,
) {
  const staker = proof.leafOwner;
  return buildIssueLicenseIx(
    programId,
    {
      buyer,
      delegate,
      staker,
      configPda,
      userRevenuePda: findUserRevenuePda(programId, staker),
      usdcMint,
      buyerUsdc: getAssociatedTokenAddress(usdcMint, buyer),
      delegateUsdc: getAssociatedTokenAddress(usdcMint, delegate),
      poolUsdc: getAssociatedTokenAddress(usdcMint, configPda, /*allowOwnerOffCurve*/ true),
      rootMerkleTree: proof.treeId,
      licenseMerkleTree,
      licenseTreeConfig: findBubblegumTreeConfig(licenseMerkleTree),
      licenseTreeAuthority: findLicenseTreeAuthority(programId, licenseMerkleTree),
      licenseCollection,
      mplCoreCpiSigner: findMplCoreCpiSigner(),
      proofAccounts: proof.proof,
    },
    {
      root: proof.root,
      nonce: proof.nonce,
      index: proof.index,
      dataHash: proof.dataHash,
      creatorHash: proof.creatorHash,
      assetDataHash: proof.assetDataHash,
      flags: proof.flags,
      rootCollection,
      licenseMetadataUri: licenseUrl,
      licenseName,
      price,
    },
  );
}

/**
 * issue_license tx を組み立て、delegate 鍵で sign して base64 で返す。
 * 買い手は受け取った tx に自分の署名を足して broadcast する想定。
 */
export async function buildAndSignIssueLicenseTx(p: BuildTxParams): Promise<BuildTxResult> {
  const buyer = new PublicKey(p.buyerAddress);
  const delegate = p.signer.publicKey;

  // 1) Config を取得して license_collection / usdc_mint / title_core_collection を解決
  const cfgInfo = await p.connection.getAccountInfo(p.configPda, "confirmed");
  if (!cfgInfo) throw new Error(`config PDA not found: ${p.configPda.toBase58()}`);
  const cfg = decodeConfig(cfgInfo.data);

  // 2) DAS で leaf + proof
  const proof = await p.fetchProof(p.rootAssetId);

  // 3) IX 構築
  const ix = buildIxFromProof(
    p.programId,
    proof,
    buyer,
    delegate,
    cfg.titleCoreCollection,
    cfg.licenseCollection,
    p.licenseMerkleTree,
    cfg.usdcMint,
    p.configPda,
    p.licenseUrl,
    p.licenseName,
    p.price,
  );

  // 4) v0 tx 組み立て、fee_payer = buyer
  const blockhash = await p.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: buyer,
    recentBlockhash: blockhash.blockhash,
    instructions: [ix],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);

  // 5) delegate 署名のみ付与 (buyer の署名は client 側で足してもらう)
  await p.signer.signTransaction(tx);

  return {
    partialSignedTxBase64: Buffer.from(tx.serialize()).toString("base64"),
    recentBlockhash: blockhash.blockhash,
  };
}
