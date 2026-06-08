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

import { usePathname } from '@/i18n/navigation';

type SidebarState = {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (v: boolean) => void;
  forceCollapsed: boolean;
  hydrated: boolean;
  transitionsReady: boolean;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
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
  const [transitionsReady, setTransitionsReady] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const pathname = usePathname();

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') {
      setCollapsedRaw(false);
    } else {
      setCollapsedRaw(true);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    // Let the persisted width apply first, then enable transitions.
    const frame = requestAnimationFrame(() => {
      setTransitionsReady(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [hydrated]);

  // Auto-close the mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

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
      return {
        collapsed: true,
        toggle: () => {},
        setCollapsed: () => {},
        forceCollapsed,
        hydrated: false,
        transitionsReady: false,
        mobileOpen: false,
        setMobileOpen: () => {},
      };
    }
    if (forceCollapsed) {
      return {
        collapsed: true,
        toggle: () => {},
        setCollapsed: () => {},
        forceCollapsed: true,
        hydrated: true,
        transitionsReady: false,
        mobileOpen,
        setMobileOpen,
      };
    }
    return {
      // Force expanded when the mobile drawer is open so labels are visible.
      collapsed: mobileOpen ? false : collapsed,
      toggle,
      setCollapsed,
      forceCollapsed: false,
      hydrated: true,
      transitionsReady,
      mobileOpen,
      setMobileOpen,
    };
  }, [collapsed, forceCollapsed, hydrated, setCollapsed, toggle, transitionsReady, mobileOpen, setMobileOpen]);

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = useContext(SidebarContext);
  if (ctx === null) {
    throw new Error('useSidebar must be used within SidebarProvider');
  }
  return ctx;
}
