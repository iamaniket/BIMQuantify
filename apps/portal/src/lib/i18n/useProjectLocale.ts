'use client';

import { defaultLocale, isLocale, type Locale } from '@bimstitch/i18n';

import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';

/**
 * Resolve a locale tag from a project's country via the jurisdictions
 * registry. Returns the package-neutral default ('en') while the
 * jurisdictions catalog is still loading or when the country isn't
 * registered — components that want to render Dutch immediately can pass
 * the locale explicitly via `useLocale()` from next-intl instead.
 */
export function useProjectLocale(country: string | null | undefined): Locale {
  const jurisdiction = useJurisdiction(country);
  if (jurisdiction === null) return defaultLocale;
  const candidate = jurisdiction.default_locale;
  return isLocale(candidate) ? candidate : defaultLocale;
}
