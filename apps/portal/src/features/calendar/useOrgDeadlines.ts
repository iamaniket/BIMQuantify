'use client';

import type { UseQueryResult } from '@tanstack/react-query';
import { useLocale } from 'next-intl';

import { getOrgDeadlineSummary, listOrgDeadlines } from '@/lib/api/deadlines';
import type {
  CalendarDeadlineList,
  DeadlineSummary,
} from '@/lib/api/schemas/deadlines';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

/**
 * Every deadline the caller can see across all projects in the active org,
 * ranked by closeness (the API sorts by due date). `label` is localized by the
 * API from the Accept-Language header, so the active locale is part of the
 * cache key — EN and NL cache separately.
 */
export function useOrgDeadlines(): UseQueryResult<CalendarDeadlineList> {
  const locale = useLocale();
  return useAuthQuery({
    queryKey: ['calendar', 'deadlines', locale] as const,
    queryFn: (token) => listOrgDeadlines(token),
  });
}

/** Org-wide deadline aggregates (status / overdue / week buckets) for the
 * Overview KPIs + charts. Locale-independent — no labels in the payload. */
export function useOrgDeadlineSummary(): UseQueryResult<DeadlineSummary> {
  return useAuthQuery({
    queryKey: ['calendar', 'summary'] as const,
    queryFn: (token) => getOrgDeadlineSummary(token),
  });
}
