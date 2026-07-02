import { apiClient } from './client';
import {
  ReportSchema,
  ReportListSchema,
  type Report,
  type ReportList,
} from './schemas/reports';

/**
 * Free-tier snag-list PDF reports. The server adapts pooled rows to the paid
 * `ReportResponse` shape, so the paid Zod schemas validate unchanged — only the
 * URL prefix differs (`/pooled/...`).
 */

export async function listPooledReports(
  accessToken: string,
  projectId: string,
): Promise<ReportList> {
  return apiClient.get(
    `/pooled/projects/${projectId}/reports`,
    ReportListSchema,
    accessToken,
  );
}

export async function getPooledReport(
  accessToken: string,
  projectId: string,
  reportId: string,
): Promise<Report> {
  return apiClient.get(
    `/pooled/projects/${projectId}/reports/${reportId}`,
    ReportSchema,
    accessToken,
  );
}

export async function createPooledReport(
  accessToken: string,
  projectId: string,
): Promise<Report> {
  return apiClient.post(
    `/pooled/projects/${projectId}/reports`,
    {},
    ReportSchema,
    accessToken,
  );
}
