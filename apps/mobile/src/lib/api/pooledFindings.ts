import { apiClient } from '@/lib/api/client';
import {
  FindingListSchema,
  FindingSchema,
  type Finding,
  type FindingCreateInput,
  type FindingList,
  type FindingUpdateInput,
} from '@/lib/api/schemas/findings';

// The free snag endpoints now emit the PAID `Finding` shape server-side (the
// single serializer `_free_finding_to_finding`), so the mobile client needs no
// free→paid adapter — only the free REQUEST mapping + the `/free` URLs differ.
// `projectId` is kept on the signatures (callers pass it) though the server now
// supplies the canonical project_id on the response.

// --- API calls -------------------------------------------------------------

/** Board feed — the API server-adapts free snags to the paid FindingRead shape. */
export async function listPooledProjectFindings(
  token: string,
  projectId: string,
): Promise<FindingList> {
  return apiClient.get<FindingList>(
    `/pooled/projects/${projectId}/findings`,
    FindingListSchema,
    token,
  );
}

export async function getPooledFinding(
  token: string,
  projectId: string,
  findingId: string,
): Promise<Finding> {
  void projectId;
  return apiClient.get<Finding>(`/pooled/findings/${findingId}`, FindingSchema, token);
}

export async function createPooledFinding(
  token: string,
  projectId: string,
  input: FindingCreateInput,
  idempotencyKey?: string,
): Promise<Finding> {
  void projectId;
  // Free snags are document(container)-scoped; the container id is the path param.
  const documentId = input.linked_document_id;
  if (documentId === null || documentId === undefined) {
    throw new Error('A free finding must be anchored to a document (linked_document_id).');
  }
  const body = {
    title: input.title,
    note: input.description,
    severity: input.severity,
    linked_file_type: input.linked_file_type ?? undefined,
    linked_file_id: input.linked_file_id ?? undefined,
    anchor_x: input.anchor_x ?? undefined,
    anchor_y: input.anchor_y ?? undefined,
    anchor_z: input.anchor_z ?? undefined,
    anchor_page: input.anchor_page ?? undefined,
    photo_ids: input.photo_ids ?? undefined,
  };
  return apiClient.post<Finding>(
    `/pooled/documents/${documentId}/findings`,
    body,
    FindingSchema,
    token,
    idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

export async function updatePooledFinding(
  token: string,
  projectId: string,
  findingId: string,
  input: FindingUpdateInput,
): Promise<Finding> {
  void projectId;
  // Map the mobile FindingUpdate → free snag update. `resolution_note` has no free
  // column (free snags carry no resolution note) and is dropped; evidence photos
  // carry over as resolution_evidence_ids.
  const body: Record<string, unknown> = {};
  if (input.status !== undefined) body['status'] = input.status;
  if (input.assignee_user_id !== undefined) body['assigned_to_user_id'] = input.assignee_user_id;
  if (input.deadline_date !== undefined) body['deadline_date'] = input.deadline_date;
  if (input.resolution_evidence_ids !== undefined) {
    body['resolution_evidence_ids'] = input.resolution_evidence_ids;
  }
  return apiClient.patch<Finding>(`/pooled/findings/${findingId}`, body, FindingSchema, token);
}
