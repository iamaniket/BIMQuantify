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
  source_checklist_item_id: z.union([z.string().uuid(), z.null()]),
  borgingsmoment_id: z.union([z.string().uuid(), z.null()]),
  linked_model_id: z.union([z.string().uuid(), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  linked_element_global_id: z.union([z.string(), z.null()]),
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
  photo_ids: z.array(z.string().uuid()).optional(),
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
  photo_ids: z.array(z.string().uuid()).optional(),
  resolution_note: z
    .union([z.string().max(4000), z.null()])
    .optional(),
  resolution_evidence_ids: z.array(z.string().uuid()).optional(),
});

export type FindingUpdateInput = z.infer<typeof FindingUpdateSchema>;

export const FindingHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  actor_user_id: z.union([z.string().uuid(), z.null()]),
  actor_name: z.union([z.string(), z.null()]),
  actor_email: z.union([z.string(), z.null()]),
  from_status: z.union([z.string(), z.null()]),
  to_status: z.union([z.string(), z.null()]),
  created_at: z.string(),
});

export type FindingHistoryEntry = z.infer<typeof FindingHistoryEntrySchema>;

export const FindingHistoryListSchema = z.array(FindingHistoryEntrySchema);

export type FindingHistoryList = z.infer<typeof FindingHistoryListSchema>;
