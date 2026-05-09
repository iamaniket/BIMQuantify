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

type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
  forceCollapsed: boolean;
};

const SidebarContext = createContext<SidebarState | null>(null);

const STORAGE_KEY = 'bimstitch.sidebar-collapsed';

type ProviderProps = {
  children: ReactNode;
  forceCollapsed?: boolean;
};

export function SidebarProvider({ children, forceCollapsed = false }: ProviderProps): JSX.Element {
  const [collapsed, setCollapsedRaw] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') {
      setCollapsedRaw(false);
    } else {
      setCollapsedRaw(true);
    }
    setHydrated(true);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedRaw(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  const toggle = useCallback(() => {
    setCollapsedRaw((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  const value = useMemo<SidebarState>(() => {
    if (!hydrated) {
      return { collapsed: true, toggle: () => {}, setCollapsed: () => {}, forceCollapsed };
    }
    if (forceCollapsed) {
      return { collapsed: true, toggle: () => {}, setCollapsed: () => {}, forceCollapsed: true };
    }
    return { collapsed, toggle, setCollapsed, forceCollapsed: false };
  }, [collapsed, forceCollapsed, hydrated, setCollapsed, toggle]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (ctx === null) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}
