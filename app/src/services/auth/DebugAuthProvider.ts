// Debug 用 auth 実装。
//
// SecureStore に keypair (= 64 byte base58) を 1 つだけ保持し、 起動時に復元する。
// 初回起動でキーが無ければ自動生成して保存する。 同じ端末では同じ wallet が使われ続ける
// ので、 cNFT mint / staking 等を繰り返しテストできる。
//
// 環境変数 `EXPO_PUBLIC_DEBUG_WALLET_BASE58` (= 64 byte base58 secret) があれば、
// SecureStore より優先してそれを使う。 共有 wallet で smoke する場合に使う。
//
// `login()` / `logout()` は即座に解決する (= 認証 UI 無し)。 logout は SecureStore を
// クリアして次回起動で新規 wallet を生成させる。

import * as SecureStore from 'expo-secure-store';
import { Keypair, type Transaction, type VersionedTransaction } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519';
import bs58 from 'bs58';

import type { AuthProvider, AuthState } from './types';
import { DEBUG_WALLET_BASE58 } from '../../env';

const STORAGE_KEY = 'rootlens.debug_wallet.v1';
const PROVIDER_ID = 'debug';

export class DebugAuthProvider implements AuthProvider {
  readonly id = PROVIDER_ID;

  private state: AuthState = { status: 'loading' };
  private keypair: Keypair | null = null;
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
      if (DEBUG_WALLET_BASE58) {
        this.keypair = loadKeypairFromB58(DEBUG_WALLET_BASE58);
        await SecureStore.setItemAsync(STORAGE_KEY, DEBUG_WALLET_BASE58);
      } else {
        const stored = await SecureStore.getItemAsync(STORAGE_KEY);
        if (stored) {
          this.keypair = loadKeypairFromB58(stored);
        } else {
          this.keypair = Keypair.generate();
          await SecureStore.setItemAsync(
            STORAGE_KEY,
            bs58.encode(this.keypair.secretKey),
          );
        }
      }
      this.setState({
        status: 'authenticated',
        session: { pubkey: this.keypair.publicKey, providerId: PROVIDER_ID },
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
    this.keypair = null;
    this.setState({ status: 'unauthenticated' });
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    const kp = this.requireKeypair();
    if ('version' in tx) {
      const versioned = tx as VersionedTransaction;
      versioned.sign([kp]);
      return versioned as T;
    } else {
      const legacy = tx as Transaction;
      legacy.partialSign(kp);
      return legacy as T;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    const kp = this.requireKeypair();
    // Solana の Keypair.secretKey は 64 byte (= seed 32 + pubkey 32)。
    // @noble/curves の ed25519.sign は seed 32 byte (= private key) を取る。
    return ed25519.sign(message, kp.secretKey.slice(0, 32));
  }

  private requireKeypair(): Keypair {
    if (!this.keypair) {
      throw new Error('DebugAuthProvider: not authenticated (call initialize first)');
    }
    return this.keypair;
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function loadKeypairFromB58(b58: string): Keypair {
  const decoded = bs58.decode(b58);
  if (decoded.length !== 64) {
    throw new Error(`debug wallet must be 64 bytes, got ${decoded.length}`);
  }
  return Keypair.fromSecretKey(decoded);
}
