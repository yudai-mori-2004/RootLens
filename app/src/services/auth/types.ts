// Auth 抽象インターフェース。
//
// 目的: アプリ本体は具体的な認証実装 (supabase / debug など) を知らずに、
// 「アカウント id」 と 「API 用アクセストークン」 だけ要求できるようにする。
// アカウント id はクリップ所有者の識別子だが、 サーバは Bearer token の sub しか信用しない
// (= id をクライアントから申告する経路は無い。 task 13)。
//
// 既定は SupabaseAuthProvider (= 運営発行の uuid + パスワード)。 DebugAuthProvider は
// DevSandbox 用に温存 (= トークンを発行できないので本番 API には通らない)。

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

export interface AuthSession {
  /** アカウント id。 Supabase では auth.users.id (uuid)、 debug では端末鍵の base58。 */
  accountId: string;
  /** 認証実装の識別子 (= supabase / debug)。 デバッグ表示や分岐に使う。 */
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

  /** 資格情報なしのログイン (= debug 等)。 資格情報が必要な実装は throw する。 */
  login(): Promise<void>;

  /** ログイン ID (= handle または合成メール) + パスワードでログインする。 対応実装のみ。 */
  loginWithPassword?(loginId: string, password: string): Promise<void>;

  /** ログアウト。 永続化されたセッションを消す。 */
  logout(): Promise<void>;

  /** API 呼び出し用のアクセストークン (= 必要なら内部でリフレッシュ)。 未対応実装は null。 */
  getAccessToken(): Promise<string | null>;
}
