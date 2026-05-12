// Demo-mode ウォレット読み出し。
//
// SPECS_JA §1.2 では Privy embedded Solana wallet を使う想定。
// 統合検証フェーズではログインフローを skip して env から固定 wallet を引く。
//
//   EXPO_PUBLIC_DEMO_WALLET_ADDRESS — base58 pubkey。Unit B の owner_wallet メタデータに渡す。
//   EXPO_PUBLIC_DEMO_KEYPAIR_BASE58 — 64B secret key (base58)。Unit G の stake tx 署名に使う。
//                                      未設定時は stake が disabled (pubkey だけでは broadcast 不能)。

import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const ENV = process.env as Record<string, string | undefined>;

export function getDemoWalletPubkey(): PublicKey | null {
  const addr = ENV.EXPO_PUBLIC_DEMO_WALLET_ADDRESS;
  if (!addr) return null;
  try {
    return new PublicKey(addr);
  } catch {
    return null;
  }
}

export function getDemoSigner(): Keypair | null {
  const sk = ENV.EXPO_PUBLIC_DEMO_KEYPAIR_BASE58;
  if (!sk) return null;
  try {
    const decoded = bs58.decode(sk);
    if (decoded.length !== 64) return null;
    return Keypair.fromSecretKey(decoded);
  } catch {
    return null;
  }
}

/** Pubkey と signer が両方揃っていて、かつ pubkey が一致しているか */
export function hasFullWallet(): boolean {
  const pk = getDemoWalletPubkey();
  const kp = getDemoSigner();
  if (!pk || !kp) return false;
  return kp.publicKey.equals(pk);
}

// ----- Buyer simulator wallet ------------------------------------------
// 撮影者から見た「AI 企業役」のデモ wallet。Settings → Buyer simulator から license
// 購入をオンチェーン実行するために使う。SOL + mock USDC を pre-funded で持つ前提。

export function getBuyerPubkey(): PublicKey | null {
  const addr = ENV.EXPO_PUBLIC_BUYER_WALLET_ADDRESS;
  if (!addr) return null;
  try { return new PublicKey(addr); } catch { return null; }
}

export function getBuyerSigner(): Keypair | null {
  const sk = ENV.EXPO_PUBLIC_BUYER_KEYPAIR_BASE58;
  if (!sk) return null;
  try {
    const decoded = bs58.decode(sk);
    if (decoded.length !== 64) return null;
    return Keypair.fromSecretKey(decoded);
  } catch { return null; }
}
