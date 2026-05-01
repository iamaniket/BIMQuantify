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

import {
  defaultLocale,
  getPortalMessages,
  isLocale,
  localeStorageKey,
  normalizeLocale,
  type Locale,
  type PortalMessages,
} from '@bimstitch/i18n';

type LocaleState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  hasHydrated: boolean;
  messages: PortalMessages;
};

const LocaleContext = createContext<LocaleState | null>(null);

type Props = {
  children: ReactNode;
};

function readStoredLocale(): Locale {
  if (typeof window === 'undefined') return defaultLocale;
  try {
    return normalizeLocale(window.localStorage.getItem(localeStorageKey));
  } catch {
    return defaultLocale;
  }
}

function writeStoredLocale(locale: Locale): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(localeStorageKey, locale);
  } catch {
    // localStorage may be unavailable; keep locale in memory only.
  }
}

export function LocaleProvider({ children }: Props): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    setLocaleState(readStoredLocale());
    setHasHydrated(true);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
    document.documentElement.dataset['locale'] = locale;
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale): void => {
    if (!isLocale(nextLocale)) return;
    writeStoredLocale(nextLocale);
    setLocaleState(nextLocale);
  }, []);

  const messages = useMemo(() => getPortalMessages(locale), [locale]);

  const value = useMemo<LocaleState>(
    () => ({ locale, setLocale, hasHydrated, messages }),
    [locale, setLocale, hasHydrated, messages],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleState {
  const context = useContext(LocaleContext);
  if (context === null) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}