'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type JSX,
  type ReactNode,
} from 'react';

import {
  defaultLocale,
  getWebMessages,
  localeStorageKey,
  normalizeLocale,
  type Locale,
  type WebMessages,
} from '@bimstitch/i18n';

type LocaleContextValue = {
  locale: Locale;
  t: WebMessages;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readInitialLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale;
  const fromCookie = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${localeStorageKey}=`));
  if (fromCookie) {
    return normalizeLocale(fromCookie.split('=')[1]);
  }
  const browserLang = navigator.language.slice(0, 2);
  return normalizeLocale(browserLang);
}

type Props = { children: ReactNode };

export function LocaleProvider({ children }: Props): JSX.Element {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${localeStorageKey}=${next};path=/;max-age=31536000;SameSite=Lax`;
  }, []);

  const value = useMemo(
    () => ({ locale, t: getWebMessages(locale), setLocale }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}
