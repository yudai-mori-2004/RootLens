import { usePrivy, useEmbeddedSolanaWallet } from '@privy-io/expo';

/**
 * 認証状態フック — Privy SDK の薄いラッパー
 *
 * Privy Expo SDK の usePrivy() は isAuthenticated を返さない。
 * 認証状態は user の有無で判定する（user !== null ならログイン済み）。
 */
export function useAuth() {
  const { isReady, user, logout } = usePrivy();
  const wallet = useEmbeddedSolanaWallet();
  const address = wallet?.wallets?.[0]?.address ?? null;

  return {
    isReady,
    isAuthenticated: !!user,
    address,
    user,
    logout,
  };
}
