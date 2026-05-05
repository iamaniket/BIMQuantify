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
  const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/latest`;
  return apiClient.get(path, ComplianceCheckResponseSchema, accessToken);
}

export async function triggerComplianceCheck(
  accessToken: string,
  projectId: string,
  modelId: string,
  fileId: string,
  buildingType = 'all',
): Promise<ComplianceCheckResponse> {
  const path = `/projects/${projectId}/models/${modelId}/files/${fileId}/compliance/check`;
  return apiClient.post(
    path,
    { building_type: buildingType },
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
