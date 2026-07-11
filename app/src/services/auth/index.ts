// React 側
export { AuthGate, useAuth, useAuthSession } from './AuthContext';

// 非 React (service / native) 側
export {
  getAuthProvider,
  setAuthProvider,
  getCurrentSession,
  requireCurrentSession,
  getAuthHeader,
} from './instance';

// 実装
export { DebugAuthProvider } from './DebugAuthProvider';
export { SupabaseAuthProvider } from './SupabaseAuthProvider';

// 型
export type { AuthProvider, AuthState, AuthSession, AuthStatus } from './types';
