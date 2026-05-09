'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import type { AppHeaderStatus, StatusTone } from './AppHeader';

type Overrides = {
  status: AppHeaderStatus | null;
};

type Ctx = {
  overrides: Overrides;
  set: (next: Overrides) => void;
};

const HeaderCtx = createContext<Ctx | null>(null);

const EMPTY_OVERRIDES: Overrides = { status: null };

export function AppHeaderProvider({ children }: { children: ReactNode }): JSX.Element {
  const [overrides, setOverrides] = useState<Overrides>(EMPTY_OVERRIDES);
  const value = useMemo<Ctx>(() => ({ overrides, set: setOverrides }), [overrides]);
  return <HeaderCtx.Provider value={value}>{children}</HeaderCtx.Provider>;
}

export function useAppHeaderOverrides(): Overrides {
  const ctx = useContext(HeaderCtx);
  if (ctx === null) return EMPTY_OVERRIDES;
  return ctx.overrides;
}

type UseAppHeaderArgs = {
  statusLabel: string | null;
  statusTone: StatusTone | undefined;
};

function buildStatus(
  statusLabel: string | null,
  statusTone: StatusTone | undefined,
): AppHeaderStatus | null {
  if (statusLabel === null || statusLabel.length === 0) return null;
  return { label: statusLabel, tone: statusTone };
}

export function useAppHeader({ statusLabel, statusTone }: UseAppHeaderArgs): void {
  const ctx = useContext(HeaderCtx);
  useEffect(() => {
    if (ctx === null) return undefined;
    ctx.set({ status: buildStatus(statusLabel, statusTone) });
    return () => {
      ctx.set(EMPTY_OVERRIDES);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusLabel, statusTone]);
}
