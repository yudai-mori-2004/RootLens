// Supabase Auth 実装 (task 13)。
//
// 運営が発行した合成メール (<handle>@rl.local) + パスワードでログインする。
// アカウント id は auth.users.id (uuid)。 セッション (JWT + refresh token) は
// expo-secure-store (= iOS Keychain) に永続化し、 アクセストークンは getSession() が
// 必要に応じてリフレッシュする。
//
// 現場名などの意味論はどこにも持たない (= アプリは「データを取って id に紐づける機械」)。

import { createClient, type SupabaseClient, type Session } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import type { AuthProvider, AuthState } from './types';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../env';

const PROVIDER_ID = 'supabase';

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
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
    this.client.auth.onAuthStateChange((_event, session) => {
      this.applySession(session);
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
    try {
      const { data } = await this.client.auth.getSession();
      this.applySession(data.session);
    } catch (err) {
      console.error('[SupabaseAuthProvider] initialize failed', err);
      this.setState({ status: 'unauthenticated' });
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
    await this.client.auth.signOut();
    this.setState({ status: 'unauthenticated' });
  }

  /** アクセストークン。 期限切れなら getSession() がリフレッシュして返す。 */
  async getAccessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  private applySession(session: Session | null) {
    if (session?.user) {
      this.setState({
        status: 'authenticated',
        session: { accountId: session.user.id, providerId: PROVIDER_ID },
      });
    } else if (this.state.status !== 'loading' || this.initialized) {
      this.setState({ status: 'unauthenticated' });
    }
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}
