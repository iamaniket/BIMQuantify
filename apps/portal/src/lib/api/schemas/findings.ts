import { z } from 'zod';

import { anchorReadFields, anchorWriteFields } from './anchor';

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
  source_checklist_item_id: z.union([z.string().uuid(), z.null()]),
  borgingsmoment_id: z.union([z.string().uuid(), z.null()]),
  linked_model_id: z.union([z.string().uuid(), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  linked_element_global_id: z.union([z.string(), z.null()]),
  ...anchorReadFields,
  photo_ids: z.union([z.array(z.string()), z.null()]),
  resolution_note: z.union([z.string(), z.null()]),
  resolution_evidence_ids: z.union([z.array(z.string()), z.null()]),
  reference_attachment_ids: z.union([z.array(z.string()), z.null()]),
  // Custom form template (#templates): the template a finding was created from
  // (null = standard form) and the answer snapshot {fieldId: {label,type,value}}.
  template_id: z.union([z.string().uuid(), z.null()]),
  custom_values: z.union([
    z.record(z.string(), z.object({ label: z.string(), type: z.string(), value: z.unknown() })),
    z.null(),
  ]),
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
  bbl_article_ref: z
    .union([z.string().max(50), z.null()])
    .optional(),
  linked_model_id: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  linked_file_id: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  linked_element_global_id: z
    .union([z.string().max(255), z.null()])
    .optional(),
  ...anchorWriteFields,
  photo_ids: z.array(z.string().uuid()).optional(),
  reference_attachment_ids: z.array(z.string().uuid()).optional(),
  // Custom form template (#templates): the chosen template + raw answers
  // (validated + snapshotted server-side against the template's field defs).
  template_id: z.union([z.string().uuid(), z.null()]).optional(),
  custom_values: z.record(z.string(), z.unknown()).optional(),
});

export type FindingCreateInput = z.infer<typeof FindingCreateSchema>;

export const FindingUpdateSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .optional(),
  description: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional(),
  severity: FindingSeverityEnum.optional(),
  bbl_article_ref: z
    .union([z.string().max(50), z.null()])
    .optional(),
  status: FindingStatusEnum.optional(),
  assignee_user_id: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  deadline_date: z
    .union([z.string(), z.null()])
    .optional(),
  linked_model_id: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  linked_file_id: z
    .union([z.string().uuid(), z.null()])
    .optional(),
  linked_element_global_id: z
    .union([z.string().max(255), z.null()])
    .optional(),
  ...anchorWriteFields,
  photo_ids: z.array(z.string().uuid()).optional(),
  resolution_note: z
    .union([z.string().max(4000), z.null()])
    .optional(),
  resolution_evidence_ids: z.array(z.string().uuid()).optional(),
  reference_attachment_ids: z.array(z.string().uuid()).optional(),
});

export type FindingUpdateInput = z.infer<typeof FindingUpdateSchema>;

export const FindingHistoryChangeSchema = z.object({
  field: z.string(),
  from_value: z.union([z.string(), z.null()]),
  to_value: z.union([z.string(), z.null()]),
});

export type FindingHistoryChange = z.infer<typeof FindingHistoryChangeSchema>;

export const FindingHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actor_user_id: z.union([z.string().uuid(), z.null()]),
  actor_name: z.union([z.string(), z.null()]),
  actor_email: z.union([z.string(), z.null()]),
  from_status: z.union([z.string(), z.null()]),
  to_status: z.union([z.string(), z.null()]),
  // Field-level diff for this entry (what changed, e.g. deadline/photos). The
  // API always sends the key (default []), so no `.default()` is needed — the
  // schema's input and output stay identical (apiClient round-trip rule).
  changes: z.array(FindingHistoryChangeSchema),
  created_at: z.string(),
});

export type FindingHistoryEntry = z.infer<typeof FindingHistoryEntrySchema>;

export const FindingHistoryListSchema = z.array(FindingHistoryEntrySchema);

export type FindingHistoryList = z.infer<typeof FindingHistoryListSchema>;
