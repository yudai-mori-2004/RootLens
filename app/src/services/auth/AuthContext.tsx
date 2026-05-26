// React からの auth アクセス窓口。
//
// `<AuthGate>` でアプリ全体を包むと、 配下のどこからでも `useAuth()` で provider と
// 現在の状態を取れる。 `useAuthSession()` は authenticated 時のみの session を返す
// (= 撮影フローのように既に gate 越え済の画面で使う)。
//
// 非 React コード (= services) は `getAuthProvider()` / `requireCurrentSession()`
// を `./instance` から取る。 両者は同じ singleton を共有。

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AuthProvider, AuthSession, AuthState } from './types';
import { getAuthProvider } from './instance';

interface AuthContextValue {
  provider: AuthProvider;
  state: AuthState;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthGateProps {
  children: ReactNode;
}

export const AuthGate: React.FC<AuthGateProps> = ({ children }) => {
  const provider = useMemo(() => getAuthProvider(), []);
  const [state, setState] = useState<AuthState>(() => provider.getState());

  useEffect(() => {
    const unsubscribe = provider.subscribe(setState);
    // 起動時に initialize を 1 回呼ぶ。 provider 側で冪等。
    void provider.initialize();
    return unsubscribe;
  }, [provider]);

  const value = useMemo<AuthContextValue>(() => ({ provider, state }), [provider, state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth: missing <AuthGate> ancestor');
  }
  return ctx;
}

/** authenticated を強制する。 撮影フローや home tab で使う。 */
export function useAuthSession(): AuthSession {
  const { state } = useAuth();
  if (state.status !== 'authenticated') {
    throw new Error(`useAuthSession: not authenticated (status=${state.status})`);
  }
  return state.session;
}
