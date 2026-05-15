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

/**
 * concurrent merkle tree account の生バイト列から canopy_depth を読み出す。
 *
 * spl-account-compression / mpl-account-compression 共通の account layout:
 *
 *   header (56B):
 *     account_type   u8
 *     header_variant u8
 *     max_buffer_size u32 LE   (offset  2)
 *     max_depth       u32 LE   (offset  6)
 *     authority       Pubkey   (offset 10, 32B)
 *     creation_slot   u64 LE   (offset 42)
 *     _padding        [u8; 6]  (offset 50)
 *
 *   body: ConcurrentMerkleTree<MAX_DEPTH, MAX_BUFFER_SIZE>
 *     sequence_number u64
 *     active_index    u64
 *     buffer_size     u64
 *     change_logs     [ChangeLog<MAX_DEPTH>; MAX_BUFFER_SIZE]
 *     rightmost_proof Path<MAX_DEPTH>
 *
 *   canopy: ((1 << (canopy_depth+1)) - 2) * 32 bytes
 *
 * canopy_depth は account 作成時に決まり、 ヘッダには記録されない。
 * 全体サイズから body サイズを引いた残り (canopy 領域) のバイト数から逆算する。
 *
 * canopy なし (= fixture や古いツリー) のときは 0 を返す。 ヘッダ不正 / 想定外
 * サイズの場合も 0 を返して、 呼び出し側は full proof のまま動く。
 */
export function inferCanopyDepth(treeAccountData: Buffer | Uint8Array): number {
  const buf = Buffer.isBuffer(treeAccountData) ? treeAccountData : Buffer.from(treeAccountData);
  const HEADER_SIZE = 56;
  if (buf.length < HEADER_SIZE) return 0;

  const maxBufferSize = buf.readUInt32LE(2);
  const maxDepth = buf.readUInt32LE(6);
  if (maxDepth === 0 || maxBufferSize === 0) return 0;

  const changeLogSize = 32 + 32 * maxDepth + 4 + 4;        // ChangeLog<D>
  const pathSize = 32 * maxDepth + 32 + 4 + 4;             // Path<D>
  const cmtBody = 24 + changeLogSize * maxBufferSize + pathSize;
  const canopyBytes = buf.length - HEADER_SIZE - cmtBody;

  if (canopyBytes <= 0 || canopyBytes % 32 !== 0) return 0;
  const canopyNodes = canopyBytes / 32;
  // canopy には 2 + 4 + 8 + ... + 2^canopy_depth = 2^(canopy_depth+1) - 2 個の
  // ノードが格納されている。 canopy_nodes + 2 が 2 のべき乗なら有効、 そうで
  // なければ未知の layout として 0 を返す。
  const target = canopyNodes + 2;
  if ((target & (target - 1)) !== 0) return 0;
  return Math.log2(target) - 1;
}

/**
 * canopy_depth を考慮して proof 配列の末尾を切り詰める。
 *
 * Bubblegum / spl-account-compression は canopy の段数 ぶん上層をオンチェーン
 * 側に保管しており、 client は残り `depth - canopy_depth` 段ぶんの sibling
 * のみ tx に詰めれば済む。 canopy=0 のツリーでは何も切らず元の proof をそのまま
 * 返す。
 *
 * pure 関数。 入力配列は変更しない。
 */
export function truncateProofForCanopy<T>(proof: ReadonlyArray<T>, canopyDepth: number): T[] {
  if (canopyDepth <= 0) return proof.slice();
  const keep = Math.max(0, proof.length - canopyDepth);
  return proof.slice(0, keep);
}

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
