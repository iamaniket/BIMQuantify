import { z } from 'zod';

export const FindingSeverityEnum = z.enum(['low', 'medium', 'high']);
export type FindingSeverityValue = z.infer<typeof FindingSeverityEnum>;

export const FindingStatusEnum = z.enum([
  'draft',
  'open',
  'in_progress',
  'resolved',
  'verified',
]);
export type FindingStatusValue = z.infer<typeof FindingStatusEnum>;

export const FindingSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  severity: FindingSeverityEnum,
  status: FindingStatusEnum,
  assignee_user_id: z.union([z.string().uuid(), z.null()]),
  deadline_date: z.union([z.string(), z.null()]),
  bbl_article_ref: z.union([z.string(), z.null()]),
  created_by_user_id: z.string().uuid(),
  linked_document_id: z.union([z.string().uuid(), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  linked_element_global_id: z.union([z.string(), z.null()]),
  linked_file_type: z.union([z.enum(['ifc', 'pdf', 'dxf', 'dwg', 'image']), z.null()]),
  anchor_x: z.union([z.number(), z.null()]),
  anchor_y: z.union([z.number(), z.null()]),
  anchor_z: z.union([z.number(), z.null()]),
  anchor_page: z.union([z.number(), z.null()]),
  photo_ids: z.union([z.array(z.string()), z.null()]),
  resolution_note: z.union([z.string(), z.null()]),
  resolution_evidence_ids: z.union([z.array(z.string()), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingListSchema = z.array(FindingSchema);
export type FindingList = z.infer<typeof FindingListSchema>;

export const FindingCreateSchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(4000),
  severity: FindingSeverityEnum,
  linked_document_id: z.union([z.string().uuid(), z.null()]).optional(),
  linked_file_id: z.union([z.string().uuid(), z.null()]).optional(),
  linked_file_type: z.union([z.enum(['ifc', 'pdf', 'dxf', 'dwg', 'image']), z.null()]).optional(),
  anchor_x: z.union([z.number(), z.null()]).optional(),
  anchor_y: z.union([z.number(), z.null()]).optional(),
  anchor_z: z.union([z.number(), z.null()]).optional(),
  // 1-based page for a PDF (2D) anchor; the API pairs it with anchor_x/y.
  anchor_page: z.union([z.number(), z.null()]).optional(),
  // Attachment ids of photos captured while logging the finding. The server
  // normalizes these into finding_attachments link rows.
  photo_ids: z.union([z.array(z.string()), z.null()]).optional(),
});

export type FindingCreateInput = z.infer<typeof FindingCreateSchema>;

// Subset of the server's FindingUpdate the mobile app drives: status transitions
// (promote/start/resolve/verify/reopen), self-assignment + deadline on promote,
// and resolution evidence on resolve. The API gates these (legal transition map,
// promote-requires-deadline+assignee, resolve-requires-note+evidence,
// verify-requires-inspector).
export const FindingUpdateSchema = z.object({
  status: FindingStatusEnum.optional(),
  assignee_user_id: z.union([z.string().uuid(), z.null()]).optional(),
  deadline_date: z.union([z.string(), z.null()]).optional(),
  resolution_note: z.union([z.string(), z.null()]).optional(),
  resolution_evidence_ids: z.union([z.array(z.string()), z.null()]).optional(),
});

export type FindingUpdateInput = z.infer<typeof FindingUpdateSchema>;
