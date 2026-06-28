'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';

import { isLocale, localeStorageKey } from '@bimdossier/i18n';

import { setApiLocale } from '@/lib/api/client';
import { usePathname, useRouter } from '@/i18n/navigation';

export function LocaleMigrationShim(): null {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  // Keep the API client's Accept-Language in sync with the active UI locale so
  // the server localizes error (and success) messages to the same language.
  useEffect(() => {
    setApiLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(localeStorageKey);
    } catch {
      return;
    }
    if (stored === null) return;
    try {
      window.localStorage.removeItem(localeStorageKey);
    } catch {
      // ignore
    }
    if (isLocale(stored) && stored !== locale) {
      router.replace(pathname, { locale: stored });
    }
  }, [locale, pathname, router]);

  return null;
}
