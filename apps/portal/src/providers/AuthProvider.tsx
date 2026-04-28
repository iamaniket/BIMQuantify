'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import { TokenPairSchema, type TokenPair } from '@/lib/api/schemas';

const STORAGE_KEY = 'bimstitch.tokens';

type AuthState = {
  tokens: TokenPair | null;
  setTokens: (tokens: TokenPair | null) => void;
  hasHydrated: boolean;
};

const AuthContext = createContext<AuthState | null>(null);

type Props = {
  children: ReactNode;
};

function readStoredTokens(): TokenPair | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = TokenPairSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeStoredTokens(tokens: TokenPair | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (tokens === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    }
  } catch {
    // localStorage may be unavailable (private mode, quota); fall back to memory only.
  }
}

export function AuthProvider({ children }: Props): JSX.Element {
  const [tokens, setTokensState] = useState<TokenPair | null>(null);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setTokensState(readStoredTokens());
    setHasHydrated(true);
  }, []);

  const setTokens = useCallback((next: TokenPair | null): void => {
    writeStoredTokens(next);
    setTokensState(next);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ tokens, setTokens, hasHydrated }),
    [tokens, setTokens, hasHydrated],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
