import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as api from '../api/endpoints';
import { getBaseUrl, getToken, setBaseUrl, setToken } from '../api/client';
import type { UserOut } from '../api/types';

interface AuthState {
  user: UserOut | null;
  loading: boolean;
  loginError: string | null;
  signIn: (baseUrl: string, username: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Перечитать себя с сервера — после смены пароля или роли. */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (!cancelled) setUser(me);
      } catch {
        setToken(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (baseUrl: string, username: string, password: string) => {
    setLoginError(null);
    setBaseUrl(baseUrl);
    try {
      await api.login(username, password);
      const me = await api.me();
      setUser(me);
    } catch (e) {
      setLoginError((e as Error).message);
      throw e;
    }
  }, []);

  const refreshUser = useCallback(async () => {
    setUser(await api.me());
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  // Мемоизировано, а не собирается заново на каждый рендер: без этого
  // любой компонент, подписанный на useAuth(), перерисовывался бы вместе с
  // провайдером — даже когда сам auth-статус не менялся ни на йоту.
  const value = useMemo(
    () => ({ user, loading, loginError, signIn, signOut, refreshUser }),
    [user, loading, loginError, signIn, signOut, refreshUser],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth должен использоваться внутри AuthProvider');
  return ctx;
}

export function currentBaseUrl(): string {
  return getBaseUrl();
}
