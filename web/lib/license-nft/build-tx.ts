// SPDX-License-Identifier: Apache-2.0
//
// issue_license tx を組み立てて delegate 署名を付与する。
// 依存は引数注入 (Connection / fetchProof / Signer) — unit test で mock 可能。

import {
  AddressLookupTableAccount,
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
import type { RootNftProof } from "./das";
import type { DelegateSigner } from "./signer";

// @solana/spl-token を依存に入れずに ATA を導出 (server bundle を小さく保つ)
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// canopy 推定 + proof 切り詰めの実装は web/lib/license-nft/canopy.ts に分離 (Solana
// SDK 非依存の pure module、 vitest で unit test される)。
import { inferCanopyDepth, truncateProofForCanopy } from "./canopy";

export function findAssociatedTokenAddress(
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

export interface PrepareIssueLicenseInput {
  connection: Connection;
  fetchProof: (rootAssetId: string) => Promise<RootNftProof>;
  signer: DelegateSigner;
  programId: PublicKey;
  configPda: PublicKey;
  licenseMerkleTree: PublicKey;
  /** v0 tx を 1232B 内に収めるための ALT (固定アカウント群を index 化)。 未指定なら raw v0 で組む */
  addressLookupTable?: PublicKey;
  rootAssetId: string;
  licenseUrl: string;
  buyerAddress: string;
  price: bigint;
  licenseName: string;
}

export interface PrepareIssueLicenseOutput {
  partialSignedTxBase64: string;
  recentBlockhash: string;
}

function buildIxFromProof(
  programId: PublicKey,
  proof: RootNftProof,
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
      buyerUsdc: findAssociatedTokenAddress(usdcMint, buyer),
      delegateUsdc: findAssociatedTokenAddress(usdcMint, delegate),
      poolUsdc: findAssociatedTokenAddress(usdcMint, configPda, /*allowOwnerOffCurve*/ true),
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

export async function prepareIssueLicense(p: PrepareIssueLicenseInput): Promise<PrepareIssueLicenseOutput> {
  const buyer = new PublicKey(p.buyerAddress);
  const delegate = p.signer.publicKey;

  const cfgInfo = await p.connection.getAccountInfo(p.configPda, "confirmed");
  if (!cfgInfo) throw new Error(`config PDA not found: ${p.configPda.toBase58()}`);
  const cfg = decodeConfig(cfgInfo.data);

  const rawProof = await p.fetchProof(p.rootAssetId);

  // canopy=0 でも >0 でも同じ経路を通る。 tree account を 1 度だけ読み、 inferred
  // canopy_depth で proof を切る (canopy=0 のときは no-op)。
  const treeInfo = await p.connection.getAccountInfo(rawProof.treeId, "confirmed");
  const canopyDepth = treeInfo ? inferCanopyDepth(treeInfo.data) : 0;
  const proof: RootNftProof = {
    ...rawProof,
    proof: truncateProofForCanopy(rawProof.proof, canopyDepth),
  };

  const ix = buildIxFromProof(
    p.programId,
    proof,
    buyer,
    delegate,
    cfg.rootNftCollection,
    cfg.licenseCollection,
    p.licenseMerkleTree,
    cfg.usdcMint,
    p.configPda,
    p.licenseUrl,
    p.licenseName,
    p.price,
  );

  let altAccounts: AddressLookupTableAccount[] = [];
  if (p.addressLookupTable) {
    const r = await p.connection.getAddressLookupTable(p.addressLookupTable, { commitment: "confirmed" });
    if (!r.value) throw new Error(`ALT not found: ${p.addressLookupTable.toBase58()}`);
    altAccounts = [r.value];
  }

  // buyer が fee_payer。 buyer 署名は client 側で追加される前提で delegate のみ partial sign
  const blockhash = await p.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: buyer,
    recentBlockhash: blockhash.blockhash,
    instructions: [ix],
  }).compileToV0Message(altAccounts);
  const tx = new VersionedTransaction(message);
  await p.signer.signTransaction(tx);

  return {
    partialSignedTxBase64: Buffer.from(tx.serialize()).toString("base64"),
    recentBlockhash: blockhash.blockhash,
  };
}
