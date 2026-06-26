import { apiClient } from './client';
import {
  ComplianceCheckResponseSchema,
  ProjectComplianceReportListSchema,
  type ComplianceCheckResponse,
  type ProjectComplianceReportItem,
} from './schemas';

export async function getComplianceLatest(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
): Promise<ComplianceCheckResponse> {
  const path = `/projects/${projectId}/documents/${modelId}/files/${fileId}/compliance/latest`;
  return apiClient.get(path, ComplianceCheckResponseSchema, accessToken);
}

export async function triggerComplianceCheck(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  buildingType?: string,
): Promise<ComplianceCheckResponse> {
  const path = `/projects/${projectId}/documents/${modelId}/files/${fileId}/compliance/check`;
  // Omit building_type unless an explicit override is given — the API then
  // derives it from the project's building type for rule filtering.
  return apiClient.post(
    path,
    buildingType ? { building_type: buildingType } : {},
    ComplianceCheckResponseSchema,
    accessToken,
  );
}

export async function listProjectReports(
  accessToken: string,
  projectId: string,
  framework?: string,
): Promise<ProjectComplianceReportItem[]> {
  const qs = framework ? `?framework=${framework}` : '';
  const path = `/projects/${projectId}/compliance/reports${qs}`;
  const resp = await apiClient.get(path, ProjectComplianceReportListSchema, accessToken);
  return resp.items;
}

export async function downloadComplianceCsv(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  framework: 'bbl' | 'wkb' = 'bbl',
): Promise<{ blob: Blob; filename: string | null }> {
  const path = `/projects/${projectId}/documents/${modelId}/files/${fileId}/compliance/export.csv?framework=${framework}`;
  return apiClient.getBlob(path, accessToken);
}

export async function downloadComplianceRulesCsv(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  framework: 'bbl' | 'wkb' = 'bbl',
): Promise<{ blob: Blob; filename: string | null }> {
  const path = `/projects/${projectId}/documents/${modelId}/files/${fileId}/compliance/export-rules.csv?framework=${framework}`;
  return apiClient.getBlob(path, accessToken);
}
