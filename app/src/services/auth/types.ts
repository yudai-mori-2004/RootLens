// Auth 抽象インターフェース。
//
// 目的: アプリ本体は具体的な認証実装 (debug / passkey / OIDC など) を知らずに、
// 「アカウント公開鍵 (= 端末が持つ Ed25519 鍵の base58)」 だけ要求できるようにする。
// アカウント公開鍵はクリップ所有者の識別子として X-Account-Pubkey header でサーバに渡る。
//
// 現状は DebugAuthProvider 一択 (= 端末ローカルに鍵を生成して保持)。

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthSession {
  /** アカウント公開鍵 (= Ed25519、 base58)。 クリップ所有者の識別子。 */
  pubkey: string;
  /** 認証実装の識別子 (= debug / ...)。 デバッグ表示や分岐に使う。 */
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

  /** ログアウト。 永続化された鍵も消す実装と消さない実装がある。 */
  logout(): Promise<void>;
}
