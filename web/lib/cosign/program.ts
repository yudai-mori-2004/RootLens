// SPDX-License-Identifier: Apache-2.0
//
// License NFT program の純粋ユーティリティ。
// 副作用なし (I/O なし、env 参照なし) なので unit test しやすい。
// tests/license-nft/{helpers,issue-helpers}.ts と等価な実装。

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";

// ===== 既知 program IDs =================================================

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const MPL_BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");
export const SPL_NOOP_PROGRAM_ID = new PublicKey("mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3");

// ===== Anchor 命令 discriminator ========================================

export function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

// ===== PDAs ==============================================================

export function findUserRevenuePda(programId: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("revenue"), user.toBuffer()],
    programId,
  );
  return pda;
}

export function findLicenseTreeAuthority(programId: PublicKey, licenseMerkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree_authority"), licenseMerkleTree.toBuffer()],
    programId,
  );
  return pda;
}

export function findBubblegumTreeConfig(merkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

export function findMplCoreCpiSigner(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mpl_core_cpi_signer")],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

/** Bubblegum get_asset_id ヘルパ。`[b"asset", tree, nonce_le]` から asset id を導出 */
export function deriveAssetId(merkleTree: PublicKey, nonce: bigint): PublicKey {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), merkleTree.toBuffer(), nonceBuf],
    MPL_BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

// ===== Config account decode =============================================

export interface ConfigAccount {
  authority: PublicKey;
  titleCoreCollection: PublicKey;
  licenseCollection: PublicKey;
  usdcMint: PublicKey;
  stakerBasisPoints: number;
  delegateBasisPoints: number;
  bump: number;
}

/**
 * Config layout (programs/license-nft/src/state.rs):
 *   8B discriminator
 *   32B authority
 *   32B title_core_collection
 *   32B license_collection
 *   32B usdc_mint
 *   2B staker_basis_points (LE u16)
 *   2B delegate_basis_points (LE u16)
 *   1B bump
 *   = 141B total
 */
export function decodeConfig(data: Buffer | Uint8Array): ConfigAccount {
  const buf = Buffer.from(data);
  if (buf.length < 141) throw new Error(`Config account too small: ${buf.length}`);
  let off = 8;
  const authority = new PublicKey(buf.subarray(off, off + 32));            off += 32;
  const titleCoreCollection = new PublicKey(buf.subarray(off, off + 32));  off += 32;
  const licenseCollection = new PublicKey(buf.subarray(off, off + 32));    off += 32;
  const usdcMint = new PublicKey(buf.subarray(off, off + 32));             off += 32;
  const stakerBasisPoints = buf.readUInt16LE(off);                         off += 2;
  const delegateBasisPoints = buf.readUInt16LE(off);                       off += 2;
  const bump = buf.readUInt8(off);
  return { authority, titleCoreCollection, licenseCollection, usdcMint, stakerBasisPoints, delegateBasisPoints, bump };
}

// ===== issue_license IX builder =========================================

export interface IssueLicenseArgs {
  root: Uint8Array;          // 32B
  nonce: bigint;
  index: number;
  dataHash: Uint8Array;       // 32B
  creatorHash: Uint8Array;    // 32B
  assetDataHash: Uint8Array;  // 32B
  flags: number;
  rootCollection: PublicKey;
  licenseMetadataUri: string;
  licenseName: string;
  price: bigint;
}

export interface IssueLicenseAccounts {
  buyer: PublicKey;
  delegate: PublicKey;
  staker: PublicKey;
  configPda: PublicKey;
  userRevenuePda: PublicKey;
  usdcMint: PublicKey;
  buyerUsdc: PublicKey;
  delegateUsdc: PublicKey;
  poolUsdc: PublicKey;
  rootMerkleTree: PublicKey;
  licenseMerkleTree: PublicKey;
  licenseTreeConfig: PublicKey;
  licenseTreeAuthority: PublicKey;
  licenseCollection: PublicKey;
  mplCoreCpiSigner: PublicKey;
  /** Bubblegum proof (remaining_accounts) */
  proofAccounts?: PublicKey[];
}

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

/**
 * issue_license IX を構築する。args 順序は programs/license-nft/src/lib.rs と一致:
 *   root, nonce, index, dataHash, creatorHash, assetDataHash, flags,
 *   rootCollection, licenseMetadataUri, licenseName, price
 */
export function buildIssueLicenseIx(
  programId: PublicKey,
  accounts: IssueLicenseAccounts,
  args: IssueLicenseArgs,
): TransactionInstruction {
  const data: Buffer[] = [anchorDiscriminator("issue_license")];
  data.push(Buffer.from(args.root));
  const nonceBuf = Buffer.alloc(8); nonceBuf.writeBigUInt64LE(args.nonce, 0); data.push(nonceBuf);
  const indexBuf = Buffer.alloc(4); indexBuf.writeUInt32LE(args.index, 0); data.push(indexBuf);
  data.push(Buffer.from(args.dataHash));
  data.push(Buffer.from(args.creatorHash));
  data.push(Buffer.from(args.assetDataHash));
  data.push(Buffer.from([args.flags]));
  data.push(args.rootCollection.toBuffer());
  data.push(borshString(args.licenseMetadataUri));
  data.push(borshString(args.licenseName));
  const priceBuf = Buffer.alloc(8); priceBuf.writeBigUInt64LE(args.price, 0); data.push(priceBuf);

  const keys = [
    { pubkey: accounts.buyer, isSigner: true, isWritable: true },
    { pubkey: accounts.delegate, isSigner: true, isWritable: true },
    { pubkey: accounts.staker, isSigner: false, isWritable: false },
    { pubkey: accounts.configPda, isSigner: false, isWritable: false },
    { pubkey: accounts.userRevenuePda, isSigner: false, isWritable: true },
    { pubkey: accounts.usdcMint, isSigner: false, isWritable: false },
    { pubkey: accounts.buyerUsdc, isSigner: false, isWritable: true },
    { pubkey: accounts.delegateUsdc, isSigner: false, isWritable: true },
    { pubkey: accounts.poolUsdc, isSigner: false, isWritable: true },
    { pubkey: accounts.rootMerkleTree, isSigner: false, isWritable: false },
    { pubkey: accounts.licenseMerkleTree, isSigner: false, isWritable: true },
    { pubkey: accounts.licenseTreeConfig, isSigner: false, isWritable: true },
    { pubkey: accounts.licenseTreeAuthority, isSigner: false, isWritable: false },
    { pubkey: accounts.licenseCollection, isSigner: false, isWritable: true },
    { pubkey: accounts.mplCoreCpiSigner, isSigner: false, isWritable: false },
    { pubkey: SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (accounts.proofAccounts) {
    for (const p of accounts.proofAccounts) {
      keys.push({ pubkey: p, isSigner: false, isWritable: false });
    }
  }
  return new TransactionInstruction({ programId, keys, data: Buffer.concat(data) });
}

// ===== issue_license IX decoder (test 用) ===============================

/** buildIssueLicenseIx と対称。tx を decode して引数を取り出す。test で形を assert するのに使う */
export function decodeIssueLicenseIxData(data: Buffer | Uint8Array): {
  discriminator: Buffer;
  root: Buffer;
  nonce: bigint;
  index: number;
  dataHash: Buffer;
  creatorHash: Buffer;
  assetDataHash: Buffer;
  flags: number;
  rootCollection: PublicKey;
  licenseMetadataUri: string;
  licenseName: string;
  price: bigint;
} {
  const buf = Buffer.from(data);
  let off = 0;
  const discriminator = buf.subarray(off, off + 8); off += 8;
  const root = Buffer.from(buf.subarray(off, off + 32)); off += 32;
  const nonce = buf.readBigUInt64LE(off); off += 8;
  const index = buf.readUInt32LE(off); off += 4;
  const dataHash = Buffer.from(buf.subarray(off, off + 32)); off += 32;
  const creatorHash = Buffer.from(buf.subarray(off, off + 32)); off += 32;
  const assetDataHash = Buffer.from(buf.subarray(off, off + 32)); off += 32;
  const flags = buf.readUInt8(off); off += 1;
  const rootCollection = new PublicKey(buf.subarray(off, off + 32)); off += 32;
  const uriLen = buf.readUInt32LE(off); off += 4;
  const licenseMetadataUri = buf.subarray(off, off + uriLen).toString("utf-8"); off += uriLen;
  const nameLen = buf.readUInt32LE(off); off += 4;
  const licenseName = buf.subarray(off, off + nameLen).toString("utf-8"); off += nameLen;
  const price = buf.readBigUInt64LE(off);
  return {
    discriminator: Buffer.from(discriminator), root, nonce, index, dataHash, creatorHash,
    assetDataHash, flags, rootCollection, licenseMetadataUri, licenseName, price,
  };
}
