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

import type { AppHeaderStatus, Crumb, StatusTone } from './AppHeader';

type Overrides = {
  status: AppHeaderStatus | null;
  crumbs: Crumb[] | null;
};

type Ctx = {
  overrides: Overrides;
  set: (next: Overrides) => void;
};

const HeaderCtx = createContext<Ctx | null>(null);

const EMPTY_OVERRIDES: Overrides = { status: null, crumbs: null };

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
    ctx.set({ status: buildStatus(statusLabel, statusTone), crumbs: null });
    return () => {
      ctx.set(EMPTY_OVERRIDES);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusLabel, statusTone]);
}

/**
 * Page-level breadcrumb override. Useful when the default path-based crumb
 * resolution in `AppHeaderRoute` can't see the data it needs (e.g. a tenant's
 * display name, which lives in a query the page is already making). Pages
 * pass their own crumbs and they replace whatever the router would have
 * produced. Crumbs reset to default on unmount.
 */
export function useHeaderCrumbsOverride(crumbs: Crumb[] | null): void {
  const ctx = useContext(HeaderCtx);
  // Serialize the crumbs to a stable key so the effect doesn't churn when
  // callers build a fresh array each render.
  const serialized = crumbs === null ? null : JSON.stringify(crumbs);
  useEffect(() => {
    if (ctx === null) return undefined;
    ctx.set({ status: ctx.overrides.status, crumbs });
    return () => {
      ctx.set({ status: ctx.overrides.status, crumbs: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);
}
