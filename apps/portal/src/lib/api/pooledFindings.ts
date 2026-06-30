import { apiClient } from './client';
import {
  FindingListSchema,
  FindingSchema,
  type Finding,
  type FindingStatusValue,
} from './schemas';

// The free snag endpoints now emit the PAID `Finding` shape server-side (the
// single serializer `_pooled_finding_to_finding`), so the client needs no
// free→paid adapter — only the free REQUEST shapes + the `/free` URLs differ.

export type PooledFindingCreateInput = {
  title: string;
  note?: string | null;
  severity: 'low' | 'medium' | 'high';
  linked_file_type?: string;
  linked_file_id?: string | null;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  anchor_page?: number | null;
  linked_element_global_id?: string | null;
  assigned_to_user_id?: string | null;
  // ISO calendar date (YYYY-MM-DD), mirrors paid Finding.deadline_date.
  deadline_date?: string | null;
};

export type PooledFindingUpdateInput = {
  title?: string;
  note?: string | null;
  severity?: 'low' | 'medium' | 'high';
  // Value-identical to the paid FindingStatus (the free board reuses the paid
  // lifecycle): draft / open / in_progress / resolved / verified.
  status?: FindingStatusValue;
  assigned_to_user_id?: string | null;
  deadline_date?: string | null;
};

export async function listPooledFindings(
  accessToken: string,
  documentId: string,
): Promise<Finding[]> {
  return apiClient.get<Finding[]>(
    `/pooled/documents/${documentId}/findings`,
    FindingListSchema,
    accessToken,
  );
}

export async function createPooledFinding(
  accessToken: string,
  documentId: string,
  input: PooledFindingCreateInput,
): Promise<Finding> {
  return apiClient.post<Finding>(
    `/pooled/documents/${documentId}/findings`,
    input,
    FindingSchema,
    accessToken,
  );
}

export async function updatePooledFinding(
  accessToken: string,
  snagId: string,
  input: PooledFindingUpdateInput,
): Promise<Finding> {
  return apiClient.patch<Finding>(
    `/pooled/findings/${snagId}`,
    input,
    FindingSchema,
    accessToken,
  );
}

/** Download the free project's findings as CSV (mirrors `downloadFindingsCsv`).
 * The free export takes no filters — it returns every finding in the project. */
export async function downloadPooledFindingsCsv(
  accessToken: string,
  projectId: string,
): Promise<{ blob: Blob; filename: string | null }> {
  return apiClient.getBlob(`/pooled/projects/${projectId}/findings/export.csv`, accessToken);
}

export async function deletePooledFinding(
  accessToken: string,
  snagId: string,
): Promise<void> {
  return apiClient.delete(`/pooled/findings/${snagId}`, accessToken);
}
