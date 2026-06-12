'use client';

import { useQuery } from '@tanstack/react-query';
import { useLocale } from 'next-intl';
import { useMemo } from 'react';

import { listHolidays } from '@/lib/api/holidays';

const STALE_MS = 24 * 60 * 60 * 1000; // 24h — holidays are stable for a year.

/**
 * Public holidays for the project's country across the `years` the calendar
 * currently shows (the 6-week grid spans 1–2 years at Dec/Jan edges), merged
 * into a single `iso → name` map. Locale is part of the cache key so EN and NL
 * names cache separately. Returns an empty map when `country` is unknown — the
 * backend returns `[]` for countries the holidays library doesn't implement,
 * so the calendar simply renders no holiday markers.
 */
export function useHolidays(
  country: string | null | undefined,
  years: number[],
): Map<string, string> {
  const locale = useLocale();
  const code = country === null || country === undefined ? null : country.toUpperCase();
  const uniqueYears = useMemo(
    () => Array.from(new Set(years)).sort((a, b) => a - b),
    [years],
  );

  const query = useQuery({
    queryKey: ['jurisdictions', code, 'holidays', uniqueYears, locale],
    queryFn: async () => {
      const lists = await Promise.all(
        // `code` is non-null here — the query is disabled when it is null.
        uniqueYears.map((year) => listHolidays(code!, year, locale)),
      );
      return lists.flat();
    },
    enabled: code !== null && uniqueYears.length > 0,
    staleTime: STALE_MS,
  });

  // `query.data` is reference-stable between refetches, so the map is too.
  return useMemo(() => {
    const map = new Map<string, string>();
    for (const holiday of query.data ?? []) map.set(holiday.date, holiday.name);
    return map;
  }, [query.data]);
}
