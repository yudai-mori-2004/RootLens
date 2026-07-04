// 認証 provider のプロセス内 singleton。
//
// React コンポーネントは useAuth() フックを使い、 service / native 層など
// 非 React コードはここの module 関数経由でアクセスする。 両者は同じ
// instance を共有しているので、 状態の整合性は AuthProvider が担保する。
//
// 差し替えは `setAuthProvider()` で行う (= テスト or 本格認証への移行)。

import type { AuthProvider, AuthSession } from './types';
import { DebugAuthProvider } from './DebugAuthProvider';

let instance: AuthProvider | null = null;

export function getAuthProvider(): AuthProvider {
  if (!instance) {
    instance = new DebugAuthProvider();
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
