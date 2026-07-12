// 認証 provider のプロセス内 singleton。
//
// React コンポーネントは useAuth() フックを使い、 service / native 層など
// 非 React コードはここの module 関数経由でアクセスする。 両者は同じ
// instance を共有しているので、 状態の整合性は AuthProvider が担保する。
//
// 差し替えは `setAuthProvider()` で行う (= テスト or 本格認証への移行)。

import type { AuthProvider, AuthSession } from './types';
import { DebugAuthProvider } from './DebugAuthProvider';
import { SupabaseAuthProvider } from './SupabaseAuthProvider';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../env';

let instance: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!instance) {
    // 既定は Supabase (task 13)。 debug への fallback は dev ビルド限定。
    // release で env が欠けたまま debug に落ちると、 ed25519 の野良アカウントで
    // 撮影できてしまう (= build 25 で実際に起きた)。 release では起動時に即死させて
    // ビルド設定の欠落を露見させる。
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      instance = new SupabaseAuthProvider();
    } else if (__DEV__) {
      instance = new DebugAuthProvider();
    } else {
      throw new Error(
        'auth: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY がビルドに焼き込まれていません (eas.json production.env を確認)',
      );
    }
  }
  return instance;
}

export function setAuthProvider(provider: AuthProvider): void {
  instance = provider;
}

/** 現在の session を取得。 未認証なら null を返す (= 撮影前の Login 画面など)。 */
export function getCurrentSession(): AuthSession | null {
  const state = getAuthProvider().getState();
  return state.status === 'authenticated' ? state.session : null;
}

/** authenticated を必須とする呼び出し用 (= clip pipeline 等)。 */
export function requireCurrentSession(): AuthSession {
  const session = getCurrentSession();
  if (!session) {
    throw new Error('auth: no authenticated session');
  }
  return session;
}

/**
 * API 呼び出し用の Authorization ヘッダ。 トークンが取れない (= 未ログイン / debug provider)
 * 場合は throw する。 サーバはこのトークンの sub をアカウント id として使う (task 13)。
 */
export async function getAuthHeader(): Promise<{ Authorization: string }> {
  const provider = getAuthProvider();
  const token = await provider.getAccessToken();
  if (!token) {
    // identity は分かっているがトークンが取れない = ほぼオフライン (リフレッシュ不能)。
    throw new Error(
      provider.getState().status === 'authenticated'
        ? 'アクセストークンを更新できませんでした (= オフライン?)。 通信環境を確認してもう一度お試しください。'
        : '未認証: アクセストークンがありません (= ログインしてください)',
    );
  }
  return { Authorization: `Bearer ${token}` };
}
