'use client';

import {
  createContext, useContext, useMemo, useState, type JSX, type ReactNode,
} from 'react';

import type { TokenPair } from '@/lib/api/schemas';

type AuthState = {
  tokens: TokenPair | null;
  setTokens: (tokens: TokenPair | null) => void;
};

const AuthContext = createContext<AuthState | null>(null);

type Props = {
  children: ReactNode;
};

export function AuthProvider({ children }: Props): JSX.Element {
  const [tokens, setTokens] = useState<TokenPair | null>(null);

  const value = useMemo<AuthState>(
    () => ({ tokens, setTokens }),
    [tokens],
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
