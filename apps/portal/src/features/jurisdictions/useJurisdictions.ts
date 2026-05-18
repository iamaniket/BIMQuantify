'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listJurisdictions, type Jurisdiction, type JurisdictionList } from '@/lib/api/jurisdictions';

const jurisdictionsKey = ['jurisdictions'] as const;

const STALE_MS = 60 * 60 * 1000; // 1h — registry changes ~quarterly

export function useJurisdictions(): UseQueryResult<JurisdictionList> {
  return useQuery<JurisdictionList>({
    queryKey: jurisdictionsKey,
    queryFn: listJurisdictions,
    staleTime: STALE_MS,
  });
}

export function useJurisdiction(country: string | null | undefined): Jurisdiction | null {
  const { data } = useJurisdictions();
  if (data === undefined || country === null || country === undefined) return null;
  const upper = country.toUpperCase();
  return data.find((j) => j.country === upper) ?? null;
}
