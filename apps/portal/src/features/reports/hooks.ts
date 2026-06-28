'use client';

import {
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { PORTAL_EVENTS, track } from '@/lib/analytics';
import {
  createReport,
  getReport,
  listReports,
  signReport,
} from '@/lib/api/reports';
import type {
  CreateReportRequest,
  Report,
  ReportList,
  ReportType,
} from '@/lib/api/schemas/reports';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { reportKey, reportsListKey } from './queryKeys';

/** List of generated reports for a project, newest first. While any report in
 * the list is non-terminal (queued/running), polls every 2s so the status
 * badges in the list flip to ready/failed without reopening the preview. */
export function useReports(
  projectId: string,
  reportType?: ReportType,
): UseQueryResult<ReportList> {
  return useAuthQuery({
    queryKey: reportsListKey(projectId, reportType),
    queryFn: (accessToken) => listReports(accessToken, projectId, reportType),
    enabled: projectId.length > 0,
    refetchInterval: (query) => {
      // Stop polling once a poll errors (e.g. 401 + failed refresh). The query
      // settles to `error` but `state.data` keeps the last non-terminal snapshot,
      // so without this guard — and with the global `retry: false` — we'd fire
      // one doomed request per tick forever (#12).
      if (query.state.status === 'error') return false;
      const data = query.state.data;
      if (data === undefined) return false;
      const active = data.items.some(
        (r) => r.status === 'queued' || r.status === 'running',
      );
      return active ? 2000 : false;
    },
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
      // Error guard MUST come before the `undefined → 2000` line below: a poll
      // that errors before any data loads (404 / persistent 401) keeps
      // `data === undefined`, so without this it would poll every 2s forever
      // under the global `retry: false` (#12).
      if (query.state.status === 'error') return false;
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
    invalidateKeys: (vars, data) => [
      // Invalidate the per-type list (so the right section refreshes) and the
      // type-agnostic list, plus the freshly created report's own key.
      reportsListKey(projectId, vars.report_type),
      reportsListKey(projectId),
      reportKey(projectId, data.id),
    ],
    onSuccess: (report, vars) => {
      track(PORTAL_EVENTS.REPORT_GENERATED, {
        project_id: projectId,
        report_id: report.id,
        report_type: vars.report_type,
      });
    },
  });
}

/** Sign a verklaring (#32). Invalidates the declaration list + the report so
 * the signed/locked state + the re-rendered PDF surface immediately. */
export function useSignReport(
  projectId: string,
): UseMutationResult<Report, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, reportId) => signReport(accessToken, projectId, reportId),
    invalidateKeys: (_reportId, data) => [
      reportsListKey(projectId, 'completion_declaration'),
      reportsListKey(projectId),
      reportKey(projectId, data.id),
    ],
  });
}
