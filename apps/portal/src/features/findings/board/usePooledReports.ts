'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { createPooledReport, getPooledReport } from '@/lib/api/pooledReports';
import type { Report } from '@/lib/api/schemas/reports';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

const pooledReportKey = (projectId: string, reportId: string): readonly unknown[] => [
  'pooled-reports',
  projectId,
  reportId,
];

/** Single free snag-list report, polled every 2s while non-terminal (mirrors
 * `features/reports/hooks.ts::useReport`, incl. the #12 error-stop guard). */
export function usePooledReport(
  projectId: string,
  reportId: string | null,
): UseQueryResult<Report> {
  return useAuthQuery({
    queryKey: pooledReportKey(projectId, reportId ?? ''),
    queryFn: (accessToken) => {
      if (reportId === null) throw new Error('reportId is null');
      return getPooledReport(accessToken, projectId, reportId);
    },
    enabled: projectId.length > 0 && reportId !== null,
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const data = query.state.data;
      if (data === undefined) return 2000;
      if (data.status === 'queued' || data.status === 'running') return 2000;
      return false;
    },
  });
}

/** Trigger a free snag-list PDF generation. */
export function useGeneratePooledReport(
  projectId: string,
): UseMutationResult<Report, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => createPooledReport(accessToken, projectId),
    invalidateKeys: (_vars, data) => [pooledReportKey(projectId, data.id)],
  });
}
