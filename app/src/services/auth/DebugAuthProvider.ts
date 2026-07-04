// Debug 用 auth 実装。
//
// SecureStore に Ed25519 鍵 (= 64 byte base58 = seed 32 + pubkey 32) を 1 つだけ保持し、
// 起動時に復元する。 初回起動でキーが無ければ自動生成して保存する。 同じ端末では同じ
// アカウントが使われ続ける (= クリップ所有者の識別子が安定する)。
//
// 環境変数 `EXPO_PUBLIC_DEBUG_ACCOUNT_BASE58` (= 64 byte base58 secret) があれば、
// SecureStore より優先してそれを使う。 共有アカウントで smoke する場合に使う。
//
// `login()` / `logout()` は即座に解決する (= 認証 UI 無し)。 logout は SecureStore を
// クリアして次回起動で新規アカウントを生成させる。

import * as SecureStore from 'expo-secure-store';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import type { AuthProvider, AuthState } from './types';
import { DEBUG_ACCOUNT_BASE58 } from '../../env';

const STORAGE_KEY = 'rootlens.debug_wallet.v1'; // 旧キー名を踏襲 (= 既存端末の鍵を引き継ぐ)
const PROVIDER_ID = 'debug';

interface AccountKey {
  /** Ed25519 seed (32 bytes) */
  seed: Uint8Array;
  /** 公開鍵 base58 */
  pubkeyBase58: string;
}

export class DebugAuthProvider implements AuthProvider {
  readonly id = PROVIDER_ID;

  private state: AuthState = { status: 'loading' };
  private key: AccountKey | null = null;
  private listeners = new Set<(s: AuthState) => void>();

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    try {
      if (DEBUG_ACCOUNT_BASE58) {
        this.key = loadKeyFromB58(DEBUG_ACCOUNT_BASE58);
        await SecureStore.setItemAsync(STORAGE_KEY, DEBUG_ACCOUNT_BASE58);
      } else {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored) {
          this.key = loadKeyFromB58(stored);
        } else {
          this.key = generateKey();
          await SecureStore.setItemAsync(STORAGE_KEY, encodeKeyToB58(this.key));
        }
      }
      this.setState({
        status: 'authenticated',
        session: { pubkey: this.key.pubkeyBase58, providerId: PROVIDER_ID },
      });
    } catch (err) {
      console.error('[DebugAuthProvider] initialize failed', err);
      this.setState({ status: 'unauthenticated' });
    }
  }

  async login(): Promise<void> {
    if (this.state.status === 'authenticated') return;
    await this.initialize();
  }

  async logout(): Promise<void> {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    this.key = null;
    this.setState({ status: 'unauthenticated' });
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function generateKey(): AccountKey {
  const seed = new Uint8Array(32);
  crypto.getRandomValues(seed);
  return { seed, pubkeyBase58: bs58.encode(ed25519.getPublicKey(seed)) };
}

/** 64 byte (= seed 32 + pubkey 32) base58 を復元。 pubkey は seed から再導出して整合を検証する。 */
function loadKeyFromB58(b58: string): AccountKey {
  const decoded = bs58.decode(b58);
  if (decoded.length !== 64) {
    throw new Error(`debug account key must be 64 bytes, got ${decoded.length}`);
  }
  const seed = decoded.slice(0, 32);
  const pub = ed25519.getPublicKey(seed);
  const storedPub = decoded.slice(32);
  for (let i = 0; i < 32; i += 1) {
    if (pub[i] !== storedPub[i]) throw new Error('debug account key corrupt (pubkey mismatch)');
  }
  return { seed, pubkeyBase58: bs58.encode(pub) };
}

function encodeKeyToB58(key: AccountKey): string {
  const out = new Uint8Array(64);
  out.set(key.seed, 0);
  out.set(bs58.decode(key.pubkeyBase58), 32);
  return bs58.encode(out);
}
