import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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

  async function signIn(baseUrl: string, username: string, password: string) {
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
  }

  async function refreshUser() {
    setUser(await api.me());
  }

  function signOut() {
    setToken(null);
    setUser(null);
    queryClient.clear();
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginError, signIn, signOut, refreshUser }}>
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
