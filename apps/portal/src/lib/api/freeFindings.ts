import { z } from 'zod';

import { apiClient } from './client';
import type { Finding, FindingStatusValue } from './schemas';

// Mirrors the API's FreeFindingRead (routers/free_documents.py).
export const FreeFindingSchema = z.object({
  id: z.string().uuid(),
  free_document_id: z.string().uuid(),
  linked_file_id: z.string().uuid().nullable(),
  title: z.string(),
  note: z.string().nullable(),
  severity: z.string(),
  status: z.string(),
  linked_file_type: z.string(),
  anchor_x: z.number().nullable(),
  anchor_y: z.number().nullable(),
  anchor_z: z.number().nullable(),
  anchor_page: z.number().int().nullable(),
  linked_element_global_id: z.string().nullable(),
  assigned_to_user_id: z.string().uuid().nullable(),
  deadline_date: z.string().nullable(),
  // Photo evidence (free attachments) — present since the free-on-mobile work.
  photo_ids: z.array(z.string()).nullish(),
  resolution_evidence_ids: z.array(z.string()).nullish(),
});
export type FreeFinding = z.infer<typeof FreeFindingSchema>;
export const FreeFindingListSchema = z.array(FreeFindingSchema);

export type FreeFindingCreateInput = {
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

export type FreeFindingUpdateInput = {
  title?: string;
  note?: string | null;
  severity?: 'low' | 'medium' | 'high';
  // Value-identical to the paid FindingStatus (the free board reuses the paid
  // lifecycle): draft / open / in_progress / resolved / verified.
  status?: FindingStatusValue;
  assigned_to_user_id?: string | null;
  deadline_date?: string | null;
};

/**
 * Adapt a free snag to the paid `Finding` shape so the free board's mutation
 * hooks can return a `Finding` (the kanban refetches from the board feed, so the
 * fields the frontend snag schema lacks — reporter id, timestamps — are
 * placeholders that are never rendered from this object).
 */
export function freeFindingToFinding(s: FreeFinding, projectId: string, nowIso: string): Finding {
  return {
    id: s.id,
    project_id: projectId,
    title: s.title,
    description: s.note ?? s.title,
    severity: s.severity as Finding['severity'],
    status: s.status as Finding['status'],
    assignee_user_id: s.assigned_to_user_id,
    deadline_date: s.deadline_date,
    bbl_article_ref: null,
    created_by_user_id: '',
    source_checklist_item_id: null,
    borgingsmoment_id: null,
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
    reference_attachment_ids: null,
    template_id: null,
    custom_values: null,
    created_at: nowIso,
    updated_at: nowIso,
  };
}

export async function listFreeFindings(
  accessToken: string,
  documentId: string,
): Promise<FreeFinding[]> {
  return apiClient.get<FreeFinding[]>(
    `/free/documents/${documentId}/findings`,
    FreeFindingListSchema,
    accessToken,
  );
}

export async function createFreeFinding(
  accessToken: string,
  documentId: string,
  input: FreeFindingCreateInput,
): Promise<FreeFinding> {
  return apiClient.post<FreeFinding>(
    `/free/documents/${documentId}/findings`,
    input,
    FreeFindingSchema,
    accessToken,
  );
}

export async function updateFreeFinding(
  accessToken: string,
  snagId: string,
  input: FreeFindingUpdateInput,
): Promise<FreeFinding> {
  return apiClient.patch<FreeFinding>(
    `/free/findings/${snagId}`,
    input,
    FreeFindingSchema,
    accessToken,
  );
}

/** Download the free project's findings as CSV (mirrors `downloadFindingsCsv`).
 * The free export takes no filters — it returns every finding in the project. */
export async function downloadFreeFindingsCsv(
  accessToken: string,
  projectId: string,
): Promise<{ blob: Blob; filename: string | null }> {
  return apiClient.getBlob(`/free/projects/${projectId}/findings/export.csv`, accessToken);
}

export async function deleteFreeFinding(
  accessToken: string,
  snagId: string,
): Promise<void> {
  return apiClient.delete(`/free/findings/${snagId}`, accessToken);
}
