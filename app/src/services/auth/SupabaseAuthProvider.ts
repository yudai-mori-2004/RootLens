// Supabase Auth 実装 (task 13)。
//
// 運営が発行した合成メール (<handle>@rl.local) + パスワードでログインする。
// アカウント id は auth.users.id (uuid)。 セッション (JWT + refresh token) は
// expo-secure-store (= iOS Keychain) に永続化し、 アクセストークンは getSession() が
// 必要に応じてリフレッシュする。
//
// セッションの寿命 (2026-07-13 判断): 標準の「短命 JWT (1h) + 長命 refresh token」 方式。
// identity (= アカウント id) は保存済みセッションから常に復元するので、 オフラインで JWT が
// 期限切れでも「誰か」 は分かったまま (= unauthenticated に落とさない)。 落とすのは明示的な
// サインアウトとサーバ側の失効 (SIGNED_OUT イベント) だけ。 トークンの鮮度が要るのは
// アップロードの瞬間だけで、 その時 getSession() がオンラインなら黙ってリフレッシュする。
//
// 現場名などの意味論はどこにも持たない (= アプリは「データを取って id に紐づける機械」)。

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import type { AuthProvider, AuthState } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../env';

const PROVIDER_ID = 'supabase';

/// セッションの保存キー。 supabase-js の既定キー (sb-<ref>-auth-token) に依存せず明示する
/// (= initialize が同じキーを直接読んで identity を復元するため)。
const SESSION_STORAGE_KEY = 'rootlens.supabase.session.v1';

/// 合成メールのドメイン (= scripts/create_account.mjs と対)。 handle だけの入力に付与する。
const LOGIN_EMAIL_DOMAIN = 'rl.local';

// supabase-js の storage インターフェースを SecureStore に写す。
// 値はセッション JSON (~3KB)。 iOS Keychain は十分収まる。
const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export class SupabaseAuthProvider implements AuthProvider {
  readonly id = PROVIDER_ID;

  private client: SupabaseClient;
  private state: AuthState = { status: 'loading' };
  private listeners = new Set<(s: AuthState) => void>();
  private initialized = false;

  constructor() {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY が未設定です');
    }
    this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: secureStorage,
        storageKey: SESSION_STORAGE_KEY,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    this.client.auth.onAuthStateChange((event, session) => {
      // 明示的なサインアウト / サーバ側の失効だけが identity を落とす。
      // それ以外の session=null (= 期限切れ + オフラインの一時状態) では状態を保つ。
      if (event === 'SIGNED_OUT') {
        this.setState({ status: 'unauthenticated' });
      } else if (session?.user) {
        this.applySession(session);
      }
    });
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    // 1) 保存済みセッションから identity を即復元 (= オフラインでも「誰か」 は分かる)。
    let storedUserId: string | null = null;
    try {
      const raw = await SecureStore.getItemAsync(SESSION_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as { user?: { id?: string } };
        if (stored.user?.id) {
          storedUserId = stored.user.id;
          this.setState({
            status: 'authenticated',
            session: { accountId: storedUserId, providerId: PROVIDER_ID },
          });
        }
      }
    } catch (err) {
      console.warn('[SupabaseAuthProvider] stored session restore failed', err);
    }
    // 2) 裏でトークンを検証 / リフレッシュ (= オンラインなら新しい JWT に置き換わる)。
    //    ネットワーク起因で失敗しても 1) の identity は保つ。
    try {
      const { data } = await this.client.auth.getSession();
      if (data.session?.user) {
        this.applySession(data.session);
      } else if (!storedUserId) {
        this.setState({ status: 'unauthenticated' });
      }
    } catch (err) {
      console.warn('[SupabaseAuthProvider] session refresh failed (offline?)', err);
      if (!storedUserId) this.setState({ status: 'unauthenticated' });
    }
  }

  /** 資格情報なしの login は無い (= LoginScreen は loginWithPassword を使う)。 */
  async login(): Promise<void> {
    throw new Error('ID とパスワードを入力してください');
  }

  async loginWithPassword(loginId: string, password: string): Promise<void> {
    const email = loginId.includes('@') ? loginId : `${loginId}@${LOGIN_EMAIL_DOMAIN}`;
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new Error(error.message);
    }
    this.applySession(data.session);
  }

  async logout(): Promise<void> {
    try {
      await this.client.auth.signOut();
    } catch {
      // オフラインでもローカルのセッションは確実に破棄する
      await SecureStore.deleteItemAsync(SESSION_STORAGE_KEY).catch(() => {});
    }
    this.setState({ status: 'unauthenticated' });
  }

  /** アクセストークン。 期限切れなら getSession() がリフレッシュして返す。 */
  async getAccessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  private applySession(session: Session | null) {
    if (!session?.user) return; // 落とす判断は SIGNED_OUT イベント / initialize が行う
    this.setState({
      status: 'authenticated',
      session: { accountId: session.user.id, providerId: PROVIDER_ID },
    });
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
