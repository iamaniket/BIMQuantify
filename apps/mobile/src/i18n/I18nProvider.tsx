import * as Localization from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { translate, type Locale, type MessageKey, type TVars } from './t';

// Device-detect the locale (expo-localization) → nl/en, falling back to nl (the
// product default per packages/i18n). A persisted manual override (Settings
// switcher) wins. No native module is added — both deps are already installed.

const LOCALE_KEY = 'bimdossier.locale';
const SUPPORTED: readonly Locale[] = ['nl', 'en'];

function isLocale(value: string | null): value is Locale {
  return value !== null && (SUPPORTED as readonly string[]).includes(value);
}

function detectLocale(): Locale {
  const code = Localization.getLocales()[0]?.languageCode ?? null;
  return isLocale(code) ? code : 'nl';
}

type I18nValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: MessageKey, vars?: TVars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  // Seed synchronously from the device locale so the first paint is correct for
  // most users; the persisted override (if any) is loaded right after.
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await SecureStore.getItemAsync(LOCALE_KEY);
      if (active && isLocale(stored)) setLocaleState(stored);
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    void SecureStore.setItemAsync(LOCALE_KEY, next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) {
    throw new Error('useT must be used within an I18nProvider');
  }
  return ctx;
}
