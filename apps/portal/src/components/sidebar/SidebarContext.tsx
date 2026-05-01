'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

const STORAGE_KEY = 'bimstitch.sidebar-collapsed';

export function SidebarProvider({ children }: { children: ReactNode }): JSX.Element {
  const [collapsed, setCollapsedRaw] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'true') {
      setCollapsedRaw(true);
    }
    setHydrated(true);
  }, []);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedRaw(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  const toggle = useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  return (
    <SidebarContext.Provider value={hydrated ? { collapsed, toggle, setCollapsed } : { collapsed: false, toggle: () => {}, setCollapsed: () => {} }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (ctx === null) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}
