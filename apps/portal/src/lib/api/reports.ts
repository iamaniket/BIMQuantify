import { apiClient } from './client';
import {
  ReportSchema,
  ReportListSchema,
  type CreateReportRequest,
  type Report,
  type ReportList,
  type ReportType,
} from './schemas/reports';

export async function listReports(
  accessToken: string,
  projectId: string,
  reportType?: ReportType,
): Promise<ReportList> {
  const qs = reportType !== undefined ? `?report_type=${reportType}` : '';
  return apiClient.get(
    `/projects/${projectId}/reports${qs}`,
    ReportListSchema,
    accessToken,
  );
}

export async function getReport(
  accessToken: string,
  projectId: string,
  reportId: string,
): Promise<Report> {
  return apiClient.get(
    `/projects/${projectId}/reports/${reportId}`,
    ReportSchema,
    accessToken,
  );
}

export async function createReport(
  accessToken: string,
  projectId: string,
  body: CreateReportRequest,
): Promise<Report> {
  return apiClient.post(
    `/projects/${projectId}/reports`,
    body,
    ReportSchema,
    accessToken,
  );
}

/** Sign a ready verklaring (#32) — inspector-only; locks + re-renders it. */
export async function signReport(
  accessToken: string,
  projectId: string,
  reportId: string,
): Promise<Report> {
  return apiClient.post(
    `/projects/${projectId}/reports/${reportId}/sign`,
    {},
    ReportSchema,
    accessToken,
  );
}
