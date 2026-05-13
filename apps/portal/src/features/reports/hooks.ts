'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  createReport,
  getReport,
  listReports,
} from '@/lib/api/reports';
import type {
  CreateReportRequest,
  Report,
  ReportList,
  ReportType,
} from '@/lib/api/schemas/reports';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { reportKey, reportsListKey } from './queryKeys';

/** List of generated reports for a project, newest first. */
export function useReports(
  projectId: string,
  reportType?: ReportType,
): UseQueryResult<ReportList> {
  return useAuthQuery({
    queryKey: reportsListKey(projectId, reportType),
    queryFn: (accessToken) => listReports(accessToken, projectId, reportType),
    enabled: projectId.length > 0,
  });
}

/** Single report. While the report is non-terminal, polls every 2s so the
 * portal updates without needing to listen to WebSocket events. WebSocket
 * notifications are still emitted server-side and a notification listener
 * elsewhere can invalidate this key for a faster transition; the polling
 * is the safety net. */
export function useReport(
  projectId: string,
  reportId: string | null,
): UseQueryResult<Report> {
  return useAuthQuery({
    queryKey: reportKey(projectId, reportId ?? ''),
    queryFn: (accessToken) => {
      if (reportId === null) throw new Error('reportId is null');
      return getReport(accessToken, projectId, reportId);
    },
    enabled: projectId.length > 0 && reportId !== null,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data === undefined) return 2000;
      if (data.status === 'queued' || data.status === 'running') return 2000;
      return false;
    },
  });
}

/** Trigger a new report generation. Invalidates both the list and the
 * single-report key so the new card appears immediately. */
export function useGenerateReport(
  projectId: string,
): UseMutationResult<Report, Error, CreateReportRequest> {
  return useAuthMutation({
    mutationFn: (accessToken, body) => createReport(accessToken, projectId, body),
    invalidateKeys: (_vars, data) => [
      reportsListKey(projectId, 'compliance_report'),
      reportsListKey(projectId),
      reportKey(projectId, data.id),
    ],
  });
}
