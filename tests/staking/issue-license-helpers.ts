// SPDX-License-Identifier: Apache-2.0
//
// `tests/license-nft/issue-helpers.ts` の最小複製。
// staking テストパッケージを license-nft の node_modules に依存させないため、
// 必要な部分だけここにコピーしている。license-nft 側で IX layout が変わったら
// ここも追従する (= D の audit-grade テストが先に落ちるので気付ける)。

import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { createHash } from "node:crypto";
import {
  MPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  MPL_BUBBLEGUM_PROGRAM_ID,
  MPL_NOOP_PROGRAM_ID,
} from "./helpers";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
export const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

export function findLicenseTreeAuthority(
  programId: PublicKey,
  licenseMerkleTree: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree_authority"), licenseMerkleTree.toBuffer()],
    programId,
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

export interface IssueLicenseArgs {
  root: Uint8Array;
  nonce: bigint;
  index: number;
  dataHash: Uint8Array;
  creatorHash: Uint8Array;
  assetDataHash: Uint8Array;
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
  args: IssueLicenseArgs,
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
    { pubkey: MPL_ACCOUNT_COMPRESSION_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_BUBBLEGUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_NOOP_PROGRAM_ID, isSigner: false, isWritable: false },
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

/** UserRevenue PDA: seed = ["user_revenue", staker.toBuffer()] */
export function findUserRevenuePda(programId: PublicKey, staker: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_revenue"), staker.toBuffer()],
    programId,
  );
  return pda;
}
