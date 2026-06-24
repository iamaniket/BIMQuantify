import type { Finding, FindingCreateInput } from '@/lib/api/schemas/findings';

// Placeholder author id for an optimistic, not-yet-synced finding. Never shown
// (the detail screen doesn't render the author) and replaced by the real row on
// sync — but kept a valid uuid shape so nothing downstream chokes on it.
const PLACEHOLDER_USER_ID = '00000000-0000-0000-0000-000000000000';

/** Build the locally-displayable finding for an offline create, mirroring the
 * server's defaults (draft status, now timestamps, server-filled fields null). */
export function buildOptimisticFinding(
  input: FindingCreateInput,
  tempId: string,
  projectId: string,
  userId: string | undefined,
): Finding {
  const now = new Date().toISOString();
  return {
    id: tempId,
    project_id: projectId,
    title: input.title,
    description: input.description,
    severity: input.severity,
    status: 'draft',
    assignee_user_id: null,
    deadline_date: null,
    bbl_article_ref: null,
    created_by_user_id: userId ?? PLACEHOLDER_USER_ID,
    linked_model_id: input.linked_model_id ?? null,
    linked_file_id: input.linked_file_id ?? null,
    linked_element_global_id: null,
    linked_file_type: input.linked_file_type ?? null,
    anchor_x: input.anchor_x ?? null,
    anchor_y: input.anchor_y ?? null,
    anchor_z: input.anchor_z ?? null,
    anchor_page: null,
    photo_ids: input.photo_ids ?? null,
    resolution_note: null,
    resolution_evidence_ids: null,
    created_at: now,
    updated_at: now,
  };
}

/** A finding id is "pending sync" if it's a client temp id. */
export function isPendingFindingId(id: string): boolean {
  return id.startsWith('temp-');
}
