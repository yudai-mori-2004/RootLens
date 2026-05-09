// SPDX-License-Identifier: Apache-2.0
//
// delegate 署名の抽象化。dev は env の base58 keypair、prod は AWS KMS。
// 本ユニットでは env keypair のみ実装。KMS 経路は IF を確保しておくだけ。

import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";

export interface DelegateSigner {
  publicKey: PublicKey;
  /** tx に署名を付与して返す (mutates tx) */
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

/** dev: env の base58 secret key (64B = ed25519 seed+pub) で署名 */
export function envKeypairSigner(secretKeyBase58: string): DelegateSigner {
  const secret = bs58.decode(secretKeyBase58);
  if (secret.length !== 64) {
    throw new Error(`expected 64B ed25519 secret key, got ${secret.length}`);
  }
  const kp = Keypair.fromSecretKey(secret);
  return {
    publicKey: kp.publicKey,
    async signTransaction(tx) {
      tx.sign([kp]);
      return tx;
    },
  };
}

/**
 * prod: AWS KMS で署名 (未実装 — 統合フェーズで `@aws-sdk/client-kms` を使って実装)。
 * IF は確保してあるので、route.ts 側を変えずに差し替えられる。
 */
export function kmsSigner(_keyId: string, _publicKey: PublicKey): DelegateSigner {
  throw new Error("KMS signer not implemented yet");
}
