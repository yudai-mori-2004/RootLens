// Buyer simulator 専用 wallet ローダ。
//
// BuyerScreen は撮影者から見た「AI 企業役」 のオンチェーン挙動 (= license NFT 購入)
// をデモで再現するためだけの画面。 本物の利用者の認証フローとは無関係なので、
// auth/AuthProvider には載せず env から直接取る (= 通常の build には影響しない)。
//
// env: src/env.ts の BUYER_WALLET_ADDRESS / BUYER_KEYPAIR_BASE58 が optional で
// セットされている時だけ Buyer simulator が動作する。

import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

import { BUYER_KEYPAIR_BASE58, BUYER_WALLET_ADDRESS } from '../env';

export function getBuyerPubkey(): PublicKey | null {
  if (!BUYER_WALLET_ADDRESS) return null;
  try { return new PublicKey(BUYER_WALLET_ADDRESS); } catch { return null; }
}

export function getBuyerSigner(): Keypair | null {
  if (!BUYER_KEYPAIR_BASE58) return null;
  try {
    const decoded = bs58.decode(BUYER_KEYPAIR_BASE58);
    if (decoded.length !== 64) return null;
    return Keypair.fromSecretKey(decoded);
  } catch { return null; }
}
