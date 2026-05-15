// SPDX-License-Identifier: Apache-2.0

import bs58 from "bs58";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

export interface DelegateSigner {
  publicKey: PublicKey;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

export function envKeypairSigner(envVar: string): DelegateSigner {
  const base58 = process.env[envVar];
  if (!base58) throw new Error(`${envVar} is not set`);
  const secret = bs58.decode(base58);
  if (secret.length !== 64) {
    throw new Error(`${envVar} decoded length ${secret.length}, expected 64`);
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
