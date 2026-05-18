'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useLocale } from 'next-intl';

import { listJurisdictions, type Jurisdiction, type JurisdictionList } from '@/lib/api/jurisdictions';

const STALE_MS = 60 * 60 * 1000; // 1h — registry changes ~quarterly

export function useJurisdictions(): UseQueryResult<JurisdictionList> {
  // Locale is part of the cache key so EN and NL responses are cached
  // separately — switching the portal language refetches the registry.
  const locale = useLocale();
  return useQuery<JurisdictionList>({
    queryKey: ['jurisdictions', locale],
    queryFn: () => listJurisdictions(locale),
    staleTime: STALE_MS,
  });
}

export function useJurisdiction(country: string | null | undefined): Jurisdiction | null {
  const { data } = useJurisdictions();
  if (data === undefined || country === null || country === undefined) return null;
  const upper = country.toUpperCase();
  return data.find((j) => j.country === upper) ?? null;
}
