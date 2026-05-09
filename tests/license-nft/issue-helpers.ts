// SPDX-License-Identifier: Apache-2.0
//
// issue_license 命令の IX builder + 関連 helper。

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { anchorDiscriminator } from "./helpers";

// 既知 program IDs
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
export const MPL_BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
// Bubblegum V2 が使う新世代の Account Compression / Noop プログラム
export const SPL_ACCOUNT_COMPRESSION_PROGRAM_ID = new PublicKey("mcmt6YrQEMKw8Mw43FmpRLmf7BqRnFMKmAcbxE3xkAW");
export const SPL_NOOP_PROGRAM_ID = new PublicKey("mnoopTCrg4p8ry25e4bcWA9XZjbNjMTfgYVGGEdRsf3");

export function findLicenseTreeAuthority(programId: PublicKey, licenseMerkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree_authority"), licenseMerkleTree.toBuffer()],
    programId
  );
  return pda;
}

export function findBubblegumTreeConfig(merkleTree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [merkleTree.toBuffer()],
    MPL_BUBBLEGUM_PROGRAM_ID
  );
  return pda;
}

export function findMplCoreCpiSigner(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mpl_core_cpi_signer")],
    MPL_BUBBLEGUM_PROGRAM_ID
  );
  return pda;
}

/**
 * issue_license args 順序 (lib.rs handler 引数と一致):
 *   root: [u8; 32]
 *   nonce: u64 (LE)
 *   index: u32 (LE)
 *   data_hash: [u8; 32]
 *   creator_hash: [u8; 32]
 *   asset_data_hash: [u8; 32]
 *   flags: u8
 *   root_collection: Pubkey
 *   license_metadata_uri: String (borsh u32 len LE + bytes)
 *   license_name: String
 *   price: u64 (LE)
 */
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
  /** 余分な merkle proof account (remaining_accounts として渡す) */
  proofAccounts?: PublicKey[];
}

function borshString(s: string): Buffer {
  const bytes = Buffer.from(s, "utf-8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

export function buildIssueLicenseIx(
  programId: PublicKey,
  accounts: IssueLicenseAccounts,
  args: IssueLicenseArgs
): TransactionInstruction {
  const data: Buffer[] = [anchorDiscriminator("issue_license")];
  data.push(Buffer.from(args.root));
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(args.nonce, 0);
  data.push(nonceBuf);
  const indexBuf = Buffer.alloc(4);
  indexBuf.writeUInt32LE(args.index, 0);
  data.push(indexBuf);
  data.push(Buffer.from(args.dataHash));
  data.push(Buffer.from(args.creatorHash));
  data.push(Buffer.from(args.assetDataHash));
  data.push(Buffer.from([args.flags]));
  data.push(args.rootCollection.toBuffer());
  data.push(borshString(args.licenseMetadataUri));
  data.push(borshString(args.licenseName));
  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigUInt64LE(args.price, 0);
  data.push(priceBuf);

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

  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat(data),
  });
}
