import { apiClient } from './client';
import {
  FindingHistoryListSchema,
  FindingListSchema,
  FindingSchema,
  type Finding,
  type FindingCreateInput,
  type FindingHistoryList,
  type FindingList,
  type FindingUpdateInput,
} from './schemas';

export async function listFindings(
  accessToken: string,
  projectId: string,
  filters?: {
    status?: string;
    severity?: string;
    linkedModelId?: string;
    linkedFileId?: string;
    linkedElementGlobalId?: string;
    unlinked?: boolean;
  },
): Promise<FindingList> {
  const params = new URLSearchParams();
  if (filters?.status !== undefined) params.set('status_filter', filters.status);
  if (filters?.severity !== undefined) params.set('severity', filters.severity);
  if (filters?.linkedModelId !== undefined) params.set('linked_model_id', filters.linkedModelId);
  if (filters?.linkedFileId !== undefined) params.set('linked_file_id', filters.linkedFileId);
  if (filters?.linkedElementGlobalId !== undefined) {
    params.set('linked_element_global_id', filters.linkedElementGlobalId);
  }
  if (filters?.unlinked === true) params.set('unlinked', 'true');
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<FindingList>(
    `/projects/${projectId}/findings${query}`,
    FindingListSchema,
    accessToken,
  );
}

export async function createFinding(
  accessToken: string,
  projectId: string,
  input: FindingCreateInput,
): Promise<Finding> {
  return apiClient.post<Finding>(
    `/projects/${projectId}/findings`,
    input,
    FindingSchema,
    accessToken,
  );
}

export async function updateFinding(
  accessToken: string,
  projectId: string,
  findingId: string,
  input: FindingUpdateInput,
): Promise<Finding> {
  return apiClient.patch<Finding>(
    `/projects/${projectId}/findings/${findingId}`,
    input,
    FindingSchema,
    accessToken,
  );
}

export async function getFindingHistory(
  accessToken: string,
  projectId: string,
  findingId: string,
): Promise<FindingHistoryList> {
  return apiClient.get<FindingHistoryList>(
    `/projects/${projectId}/findings/${findingId}/history`,
    FindingHistoryListSchema,
    accessToken,
  );
}

export async function deleteFinding(
  accessToken: string,
  projectId: string,
  findingId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/findings/${findingId}`, accessToken);
}
