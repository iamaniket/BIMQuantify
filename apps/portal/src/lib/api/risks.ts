import { apiClient } from './client';
import {
  RiskListSchema,
  RiskSchema,
  type Risk,
  type RiskCreateInput,
  type RiskList,
  type RiskUpdateInput,
} from './schemas';

export async function listRisks(
  accessToken: string,
  projectId: string,
): Promise<RiskList> {
  return apiClient.get<RiskList>(
    `/projects/${projectId}/risks`,
    RiskListSchema,
    accessToken,
  );
}

export async function createRisk(
  accessToken: string,
  projectId: string,
  input: RiskCreateInput,
): Promise<Risk> {
  return apiClient.post<Risk>(
    `/projects/${projectId}/risks`,
    input,
    RiskSchema,
    accessToken,
  );
}

export async function updateRisk(
  accessToken: string,
  projectId: string,
  riskId: string,
  input: RiskUpdateInput,
): Promise<Risk> {
  return apiClient.patch<Risk>(
    `/projects/${projectId}/risks/${riskId}`,
    input,
    RiskSchema,
    accessToken,
  );
}

export async function deleteRisk(
  accessToken: string,
  projectId: string,
  riskId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/risks/${riskId}`, accessToken);
}
