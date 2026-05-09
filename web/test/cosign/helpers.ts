// SPDX-License-Identifier: Apache-2.0
//
// build-tx 統合テスト用の fixture builder。
// Connection / DAS / Signer をすべて mock する。

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { decodeConfig } from "@/lib/cosign/program";
import type { AssetWithProof } from "@/lib/cosign/das";
import type { DelegateSigner } from "@/lib/cosign/signer";
import { vi } from "vitest";

export interface MockEnv {
  programId: PublicKey;
  configPda: PublicKey;
  licenseMerkleTree: PublicKey;
  rootMerkleTree: PublicKey;
  usdcMint: PublicKey;
  rootCollection: PublicKey;
  licenseCollection: PublicKey;
  delegateKp: Keypair;
  buyerKp: Keypair;
  stakerKp: Keypair;
  signer: DelegateSigner;
  connection: Connection;
  fetchProof: (rootAssetId: string) => Promise<AssetWithProof>;
}

/**
 * Config account の raw bytes を組み立てる (programs/license-nft/src/state.rs と一致)。
 * 8B disc + 32B authority + 32B title_core + 32B license_core + 32B usdc + 2B + 2B + 1B
 */
function buildConfigBytes(opts: {
  authority: PublicKey;
  titleCoreCollection: PublicKey;
  licenseCollection: PublicKey;
  usdcMint: PublicKey;
}): Buffer {
  const buf = Buffer.alloc(141);
  // discriminator 8B (中身は不要、decode は skip するだけ)
  let off = 8;
  opts.authority.toBuffer().copy(buf, off); off += 32;
  opts.titleCoreCollection.toBuffer().copy(buf, off); off += 32;
  opts.licenseCollection.toBuffer().copy(buf, off); off += 32;
  opts.usdcMint.toBuffer().copy(buf, off); off += 32;
  buf.writeUInt16LE(9500, off); off += 2;
  buf.writeUInt16LE(500, off); off += 2;
  buf.writeUInt8(255, off); // bump
  return buf;
}

/** decode を逆向きに通して整合確認 (テスト自体の sanity check) */
export function selfCheckConfigBytes(bytes: Buffer, expected: { authority: PublicKey; usdcMint: PublicKey }) {
  const cfg = decodeConfig(bytes);
  if (!cfg.authority.equals(expected.authority)) throw new Error("config self-check authority mismatch");
  if (!cfg.usdcMint.equals(expected.usdcMint)) throw new Error("config self-check usdc mismatch");
}

export function makeMockEnv(): MockEnv {
  const programId = new PublicKey("G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8");
  const configPda = new PublicKey("FfsaBAMBuDpWXaBKU8hCXMqtnjH4BFcwzW3EL7fhzx7U");
  const licenseMerkleTree = Keypair.generate().publicKey;
  const rootMerkleTree = Keypair.generate().publicKey;
  const usdcMint = Keypair.generate().publicKey;
  const rootCollection = Keypair.generate().publicKey;
  const licenseCollection = Keypair.generate().publicKey;
  const delegateKp = Keypair.generate();
  const buyerKp = Keypair.generate();
  const stakerKp = Keypair.generate();

  const authority = Keypair.generate().publicKey;
  const configBytes = buildConfigBytes({
    authority,
    titleCoreCollection: rootCollection,
    licenseCollection,
    usdcMint,
  });
  selfCheckConfigBytes(configBytes, { authority, usdcMint });

  // Connection mock — 必要なメソッドだけ stub
  const connection = {
    getAccountInfo: vi.fn(async (_addr: PublicKey) => ({
      data: configBytes,
      executable: false,
      lamports: 1_000_000,
      owner: programId,
      rentEpoch: 0,
    })),
    getLatestBlockhash: vi.fn(async () => ({
      // 有効な base58 32B が必要 (compileToV0Message が decode する)
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 100,
    })),
  } as unknown as Connection;

  const fetchProof = vi.fn(async (_id: string): Promise<AssetWithProof> => ({
    root: new Uint8Array(32).fill(1),
    dataHash: new Uint8Array(32).fill(2),
    creatorHash: new Uint8Array(32).fill(3),
    assetDataHash: new Uint8Array(32).fill(0),
    flags: 0,
    nonce: 7n,
    index: 7,
    leafOwner: stakerKp.publicKey,
    leafDelegate: delegateKp.publicKey,
    proof: [
      Keypair.generate().publicKey,
      Keypair.generate().publicKey,
    ],
    treeId: rootMerkleTree,
  }));

  const signer: DelegateSigner = {
    publicKey: delegateKp.publicKey,
    async signTransaction(tx) {
      tx.sign([delegateKp]);
      return tx;
    },
  };

  return {
    programId,
    configPda,
    licenseMerkleTree,
    rootMerkleTree,
    usdcMint,
    rootCollection,
    licenseCollection,
    delegateKp,
    buyerKp,
    stakerKp,
    signer,
    connection,
    fetchProof,
  };
}

/** test 用: env keypair signer の secret を生成 (route.ts の env path をテストする時に使う) */
export function generateDelegateSecretBase58(): { kp: Keypair; secretBase58: string } {
  const kp = Keypair.generate();
  return { kp, secretBase58: bs58.encode(kp.secretKey) };
}
