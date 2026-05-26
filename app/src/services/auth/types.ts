// Auth 抽象インターフェース。
//
// 目的: アプリ本体は具体的な認証実装 (Privy, Web3Auth, passkey, debug など) を
// 知らずに、ウォレット pubkey と Solana 署名能力だけ要求できるようにする。
// 将来 Privy などへ差し替えるときは AuthProvider の別実装を渡すだけで済む。
//
// 現状 (= v0.1.3 Phase F の開始時点) は DebugAuthProvider 一択。
// Privy 等の本格認証は別タスクで追加する。

import type { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthSession {
  /** Solana wallet pubkey (base58)。 X-Wallet-Pubkey header や on-chain owner として使う。 */
  pubkey: PublicKey;
  /** 認証実装の識別子 (= debug / privy / web3auth など)。 デバッグ表示や分岐に使う。 */
  providerId: string;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; session: AuthSession };

export interface AuthProvider {
  /** 実装識別子。 設定画面やテレメトリで表示する。 */
  readonly id: string;

  /** 現在の状態を取得 (同期)。 */
  getState(): AuthState;

  /** 状態変化を購読。 返り値はアンサブスクライブ関数。 */
  subscribe(listener: (state: AuthState) => void): () => void;

  /** 起動時に呼ぶ。 保存済みセッションの復元 / 初期化を行う。 */
  initialize(): Promise<void>;

  /** ログイン (= 認証フロー起動)。 完了で status=authenticated になる。 */
  login(): Promise<void>;

  /** ログアウト。 永続化された wallet も消す実装と消さない実装がある。 */
  logout(): Promise<void>;

  /** authenticated 時のみ呼び出し可。 Solana tx を payer wallet で署名する。 */
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;

  /** authenticated 時のみ呼び出し可。 任意の bytes を ed25519 署名する (= TP register 等)。 */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}
