import { apiClient, type PaginatedResponse } from './client';
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

export type FindingExportFilters = {
  status?: string;
  severity?: string;
  assigneeUserId?: string;
};

export async function listFindings(
  accessToken: string,
  projectId: string,
  filters?: {
    status?: string;
    severity?: string;
    assignee?: string;
    linkedModelId?: string;
    linkedFileId?: string;
    linkedElementGlobalId?: string;
    unlinked?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<PaginatedResponse<FindingList>> {
  const params = new URLSearchParams();
  if (filters?.status !== undefined) params.set('status_filter', filters.status);
  if (filters?.severity !== undefined) params.set('severity', filters.severity);
  if (filters?.assignee) params.set('assignee_user_id', filters.assignee);
  // UUID params: an empty string is not a valid UUID and 422s server-side, so
  // only send them when non-empty (truthy), not merely `!== undefined`.
  if (filters?.linkedModelId) params.set('linked_model_id', filters.linkedModelId);
  if (filters?.linkedFileId) params.set('linked_file_id', filters.linkedFileId);
  if (filters?.linkedElementGlobalId !== undefined) {
    params.set('linked_element_global_id', filters.linkedElementGlobalId);
  }
  if (filters?.unlinked === true) params.set('unlinked', 'true');
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.getWithMeta<FindingList>(
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

/** Download the project's findings (bevindingen) as CSV, honouring the same
 * filters as the list view. Returns the blob + the server-suggested filename
 * (parsed from Content-Disposition). Mirrors `downloadComplianceCsv`. */
export async function downloadFindingsCsv(
  accessToken: string,
  projectId: string,
  filters?: FindingExportFilters,
): Promise<{ blob: Blob; filename: string | null }> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status_filter', filters.status);
  if (filters?.severity) params.set('severity', filters.severity);
  if (filters?.assigneeUserId) params.set('assignee_user_id', filters.assigneeUserId);
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.getBlob(`/projects/${projectId}/findings/export.csv${query}`, accessToken);
}
