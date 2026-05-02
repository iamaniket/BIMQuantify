'use client';

import { useLocale } from 'next-intl';
import { useEffect } from 'react';

import { isLocale, localeStorageKey, type Locale } from '@bimstitch/i18n';

import { usePathname, useRouter } from '@/i18n/navigation';

export function LocaleMigrationShim(): null {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

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
      router.replace(pathname, { locale: stored as Locale });
    }
  }, [locale, pathname, router]);

  return null;
}
