import { z } from 'zod';

import { apiClient } from '@/lib/api/client';
import {
  FindingListSchema,
  type Finding,
  type FindingCreateInput,
  type FindingList,
  type FindingUpdateInput,
} from '@/lib/api/schemas/findings';

// Mirrors the API's FreeFindingRead (routers/free_documents.py). Used for the
// single-finding GET + create/update responses (the project-level board feed
// returns the already-adapted paid FindingRead, so that path needs no adapter).
export const FreeFindingSchema = z.object({
  id: z.string().uuid(),
  free_document_id: z.string().uuid(),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  title: z.string(),
  note: z.union([z.string(), z.null()]),
  severity: z.string(),
  status: z.string(),
  linked_file_type: z.string(),
  anchor_x: z.union([z.number(), z.null()]),
  anchor_y: z.union([z.number(), z.null()]),
  anchor_z: z.union([z.number(), z.null()]),
  anchor_page: z.union([z.number(), z.null()]),
  linked_element_global_id: z.union([z.string(), z.null()]),
  assigned_to_user_id: z.union([z.string().uuid(), z.null()]),
  deadline_date: z.union([z.string(), z.null()]),
  photo_ids: z.union([z.array(z.string()), z.null()]).nullish(),
  resolution_evidence_ids: z.union([z.array(z.string()), z.null()]).nullish(),
});
export type FreeFinding = z.infer<typeof FreeFindingSchema>;

/**
 * Adapt a free snag to the mobile `Finding` shape so the inspector UI + offline
 * cache render it unchanged. Fields the free snag lacks (reporter id, resolution
 * note, timestamps) are placeholders — the list re-fetches from the board feed,
 * so they're never the source of truth. Photos DO carry over (the whole point of
 * free-on-mobile).
 */
export function freeFindingToFinding(s: FreeFinding, projectId: string, nowIso: string): Finding {
  return {
    id: s.id,
    project_id: projectId,
    title: s.title,
    description: s.note ?? '',
    severity: s.severity as Finding['severity'],
    status: s.status as Finding['status'],
    assignee_user_id: s.assigned_to_user_id,
    deadline_date: s.deadline_date,
    bbl_article_ref: null,
    created_by_user_id: '',
    linked_document_id: s.free_document_id,
    linked_file_id: s.linked_file_id ?? s.free_document_id,
    linked_element_global_id: s.linked_element_global_id,
    linked_file_type: s.linked_file_type as Finding['linked_file_type'],
    anchor_x: s.anchor_x,
    anchor_y: s.anchor_y,
    anchor_z: s.anchor_z,
    anchor_page: s.anchor_page,
    photo_ids: s.photo_ids ?? null,
    resolution_note: null,
    resolution_evidence_ids: s.resolution_evidence_ids ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

// --- API calls -------------------------------------------------------------

/** Board feed — the API server-adapts free snags to the paid FindingRead shape,
 * so this validates with the paid FindingListSchema (no client adapter). */
export async function listFreeProjectFindings(
  token: string,
  projectId: string,
): Promise<FindingList> {
  return apiClient.get<FindingList>(
    `/free/projects/${projectId}/findings`,
    FindingListSchema,
    token,
  );
}

export async function getFreeFinding(
  token: string,
  projectId: string,
  findingId: string,
): Promise<Finding> {
  const s = await apiClient.get<FreeFinding>(
    `/free/findings/${findingId}`,
    FreeFindingSchema,
    token,
  );
  return freeFindingToFinding(s, projectId, new Date().toISOString());
}

export async function createFreeFinding(
  token: string,
  projectId: string,
  input: FindingCreateInput,
  idempotencyKey?: string,
): Promise<Finding> {
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
  const s = await apiClient.post<FreeFinding>(
    `/free/documents/${documentId}/findings`,
    body,
    FreeFindingSchema,
    token,
    idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
  return freeFindingToFinding(s, projectId, new Date().toISOString());
}

export async function updateFreeFinding(
  token: string,
  projectId: string,
  findingId: string,
  input: FindingUpdateInput,
): Promise<Finding> {
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
  const s = await apiClient.patch<FreeFinding>(
    `/free/findings/${findingId}`,
    body,
    FreeFindingSchema,
    token,
  );
  return freeFindingToFinding(s, projectId, new Date().toISOString());
}
