// SPDX-License-Identifier: Apache-2.0

import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ----- network.json -------------------------------------------------------

export interface NetworkConfig {
  cluster: string;
  program_id: string;
  config_pda: string;
  authority: string;
  root_nft_collection: string;
  license_collection: string;
  usdc_mint: string;
  staker_basis_points: number;
  delegate_basis_points: number;
}

export function loadNetwork(): NetworkConfig {
  const path = resolve(__dirname, "../../network.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function loadKeypair(filename: string): Keypair {
  const path = resolve(__dirname, "../../keys", filename);
  const bytes = JSON.parse(readFileSync(path, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

// ----- Anchor 命令 discriminator -----------------------------------------

export function anchorDiscriminator(name: string): Buffer {
  const hash = createHash("sha256");
  hash.update(`global:${name}`);
  return hash.digest().subarray(0, 8);
}

// ----- IX builders (programs/license-nft/src と一致させる) ---------------

export function buildUpdateConfigIx(
  programId: PublicKey,
  configPda: PublicKey,
  authority: PublicKey,
  args: {
    newAuthority?: PublicKey | null;
    newStakerBps?: number | null;
    newDelegateBps?: number | null;
    newRootNftCollection?: PublicKey | null;
    newUsdcMint?: PublicKey | null;
  }
): TransactionInstruction {
  const data: Buffer[] = [anchorDiscriminator("update_config")];

  function pushOptionPubkey(v: PublicKey | null | undefined) {
    if (v) {
      data.push(Buffer.from([1]));
      data.push(v.toBuffer());
    } else {
      data.push(Buffer.from([0]));
    }
  }
  function pushOptionU16(v: number | null | undefined) {
    if (v !== undefined && v !== null) {
      const buf = Buffer.alloc(3);
      buf.writeUInt8(1, 0);
      buf.writeUInt16LE(v, 1);
      data.push(buf);
    } else {
      data.push(Buffer.from([0]));
    }
  }

  // 引数順序は programs/license-nft/src/lib.rs::update_config と一致。
  pushOptionPubkey(args.newAuthority);
  pushOptionU16(args.newStakerBps);
  pushOptionU16(args.newDelegateBps);
  pushOptionPubkey(args.newRootNftCollection);
  pushOptionPubkey(args.newUsdcMint);

  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: authority, isSigner: true, isWritable: false },
      { pubkey: configPda, isSigner: false, isWritable: true },
    ],
    data: Buffer.concat(data),
  });
}

/**
 * claim_revenue ix を構築する。
 *
 * accounts (programs/license-nft/src/instructions/claim_revenue.rs):
 *   user           (signer, mut)
 *   config         (PDA, has_one usdc_mint)
 *   user_revenue   (PDA seeds=[b"revenue", user], mut)
 *   usdc_mint      (must == config.usdc_mint)
 *   pool_usdc      (mut, owner = config)
 *   user_usdc      (mut, owner = user)
 *   token_program
 */
export function buildClaimRevenueIx(
  programId: PublicKey,
  configPda: PublicKey,
  user: PublicKey,
  userRevenuePda: PublicKey,
  usdcMint: PublicKey,
  poolUsdc: PublicKey,
  userUsdc: PublicKey
): TransactionInstruction {
  const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: userRevenuePda, isSigner: false, isWritable: true },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: poolUsdc, isSigner: false, isWritable: true },
      { pubkey: userUsdc, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator("claim_revenue"),
  });
}

export function findUserRevenuePda(programId: PublicKey, user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("revenue"), user.toBuffer()],
    programId
  );
  return pda;
}

// ----- Anchor account デコーダ (Config だけ) ------------------------------

export interface ConfigAccount {
  authority: PublicKey;
  rootNftCollection: PublicKey;
  licenseCollection: PublicKey;
  usdcMint: PublicKey;
  stakerBasisPoints: number;
  delegateBasisPoints: number;
  bump: number;
}

/**
 * Config アカウントを decode する。
 *
 * layout (programs/license-nft/src/state.rs Config):
 *   8B discriminator
 *   32B authority
 *   32B root_nft_collection
 *   32B license_collection
 *   32B usdc_mint
 *   2B staker_basis_points (LE u16)
 *   2B delegate_basis_points (LE u16)
 *   1B bump
 *   = 141B total
 */
export function decodeConfig(data: Buffer): ConfigAccount {
  if (data.length < 141) {
    throw new Error(`Config account too small: ${data.length}`);
  }
  let off = 8; // skip discriminator
  const authority = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const rootNftCollection = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const licenseCollection = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const usdcMint = new PublicKey(data.subarray(off, off + 32));
  off += 32;
  const stakerBasisPoints = data.readUInt16LE(off);
  off += 2;
  const delegateBasisPoints = data.readUInt16LE(off);
  off += 2;
  const bump = data.readUInt8(off);
  return {
    authority,
    rootNftCollection,
    licenseCollection,
    usdcMint,
    stakerBasisPoints,
    delegateBasisPoints,
    bump,
  };
}

// ----- Common test setup -------------------------------------------------

export function getConnection(): Connection {
  const url = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
  return new Connection(url, "confirmed");
}

/** authority keypair が tx 手数料に十分な SOL を持つか確認 */
export async function ensureBalance(
  conn: Connection,
  pubkey: PublicKey,
  minSol: number
): Promise<void> {
  const lamports = await conn.getBalance(pubkey);
  const sol = lamports / 1e9;
  if (sol < minSol) {
    throw new Error(
      `${pubkey.toBase58()} has ${sol.toFixed(4)} SOL, need at least ${minSol} SOL`
    );
  }
}

/** ALT を解決して使えるようにする */
export async function loadAlt(
  conn: Connection,
  altAddress: PublicKey
): Promise<AddressLookupTableAccount> {
  const r = await conn.getAddressLookupTable(altAddress, { commitment: "confirmed" });
  if (!r.value) throw new Error(`ALT not found: ${altAddress.toBase58()}`);
  return r.value;
}

/** v0 tx で送る (ALT 対応)。ALT 未指定なら legacy tx と同等動作 */
async function sendV0(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  altAccounts: AddressLookupTableAccount[] = []
): Promise<string> {
  const blockhash = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: signers[0].publicKey,
    recentBlockhash: blockhash.blockhash,
    instructions: ixs,
  }).compileToV0Message(altAccounts);
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const sig = await conn.sendTransaction(tx, { skipPreflight: false, preflightCommitment: "confirmed" });
  const conf = await conn.confirmTransaction({ signature: sig, ...blockhash }, "confirmed");
  if (conf.value.err) {
    const logs = (await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? [];
    const err: any = new Error(`tx failed: ${JSON.stringify(conf.value.err)}`);
    err.logs = logs;
    throw err;
  }
  return sig;
}

/**
 * Tx を送って成功 or 失敗を期待する。Anchor のエラーが含まれる場合は
 * ログから error_code を抽出して assert に使えるようにする。
 */
export async function sendExpectingSuccess(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  altAccounts: AddressLookupTableAccount[] = []
): Promise<string> {
  if (altAccounts.length > 0) {
    return await sendV0(conn, ixs, signers, altAccounts);
  }
  const tx = new Transaction().add(...ixs);
  return await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
}

export interface SendError {
  /** Anchor #[error_code] の variant 名 (e.g. "InvalidBasisPoints") */
  errorName?: string;
  /** Solana Program Error code (numeric) */
  errorCode?: number;
  /** raw logs */
  logs: string[];
  /** raw error */
  raw: unknown;
}

/** Tx 送信し、必ずエラーになる前提で SendError を返す。成功した場合は throw。 */
export async function sendExpectingFailure(
  conn: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  altAccounts: AddressLookupTableAccount[] = []
): Promise<SendError> {
  try {
    let sig: string;
    if (altAccounts.length > 0) {
      sig = await sendV0(conn, ixs, signers, altAccounts);
    } else {
      const tx = new Transaction().add(...ixs);
      sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
    }
    throw new Error(`tx unexpectedly succeeded: ${sig}`);
  } catch (e: any) {
    const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
    const result: SendError = { logs, raw: e };

    // Anchor error: "Program log: AnchorError ... Error Code: <Name>. Error Number: <num>."
    const anchorRe = /Error Code: (\w+)\. Error Number: (\d+)/;
    for (const line of logs) {
      const m = line.match(anchorRe);
      if (m) {
        result.errorName = m[1];
        result.errorCode = parseInt(m[2], 10);
        break;
      }
    }
    return result;
  }
}
