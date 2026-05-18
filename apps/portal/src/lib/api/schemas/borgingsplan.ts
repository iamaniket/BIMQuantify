import { z } from 'zod';

export const BorgingsplanStatusEnum = z.enum(['draft', 'published', 'superseded']);
export type BorgingsplanStatusValue = z.infer<typeof BorgingsplanStatusEnum>;

export const BorgingsmomentPhaseEnum = z.enum([
  'foundation',
  'shell',
  'roof',
  'finishing',
  'handover',
  'other',
]);
export type BorgingsmomentPhaseValue = z.infer<typeof BorgingsmomentPhaseEnum>;

export const BorgingsmomentStatusEnum = z.enum([
  'planned',
  'in_progress',
  'passed',
  'failed',
  'skipped',
]);
export type BorgingsmomentStatusValue = z.infer<typeof BorgingsmomentStatusEnum>;

export const ChecklistItemTypeEnum = z.enum(['text', 'document', 'photo', 'ifc_element']);
export type ChecklistItemTypeValue = z.infer<typeof ChecklistItemTypeEnum>;

export const EvidenceTypeEnum = z.enum([
  'photo',
  'certificate',
  'measurement',
  'document',
  'signature',
]);
export type EvidenceTypeValue = z.infer<typeof EvidenceTypeEnum>;

export const ChecklistItemSchema = z.object({
  id: z.string().uuid(),
  borgingsmoment_id: z.string().uuid(),
  project_id: z.string().uuid(),
  item_type: ChecklistItemTypeEnum,
  description: z.string(),
  evidence_type: EvidenceTypeEnum,
  bbl_article_ref: z.union([z.string(), z.null()]),
  pass_fail_criteria: z.union([z.string(), z.null()]),
  sequence: z.number().int(),
  linked_element_global_id: z.union([z.string(), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  extra_data: z.union([z.record(z.string(), z.unknown()), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const BorgingsmomentSchema = z.object({
  id: z.string().uuid(),
  borgingsplan_id: z.string().uuid(),
  project_id: z.string().uuid(),
  phase: BorgingsmomentPhaseEnum,
  name: z.string(),
  planned_date: z.string(),
  actual_date: z.union([z.string(), z.null()]),
  responsible_user_id: z.union([z.string().uuid(), z.null()]),
  status: BorgingsmomentStatusEnum,
  sequence_in_phase: z.number().int(),
  notes: z.union([z.string(), z.null()]),
  checklist_items: z.array(ChecklistItemSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Borgingsmoment = z.infer<typeof BorgingsmomentSchema>;

export const BorgingsplanSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  version_number: z.number().int(),
  status: BorgingsplanStatusEnum,
  created_by_user_id: z.string().uuid(),
  published_at: z.union([z.string(), z.null()]),
  superseded_at: z.union([z.string(), z.null()]),
  notes: z.union([z.string(), z.null()]),
  moments: z.array(BorgingsmomentSchema),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Borgingsplan = z.infer<typeof BorgingsplanSchema>;

export const BorgingsplanVersionSummarySchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  version_number: z.number().int(),
  status: BorgingsplanStatusEnum,
  created_by_user_id: z.string().uuid(),
  published_at: z.union([z.string(), z.null()]),
  superseded_at: z.union([z.string(), z.null()]),
  notes: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BorgingsplanVersionSummary = z.infer<typeof BorgingsplanVersionSummarySchema>;

export const BorgingsplanVersionListSchema = z.array(BorgingsplanVersionSummarySchema);

export const BorgingsplanUpdateSchema = z.object({
  notes: z.union([z.string().max(4000), z.null()]).optional(),
});
export type BorgingsplanUpdateInput = z.infer<typeof BorgingsplanUpdateSchema>;

export const GenerateOptionsSchema = z.object({ force: z.boolean().default(false) });
export type GenerateOptionsInput = z.infer<typeof GenerateOptionsSchema>;

export const BorgingsmomentCreateSchema = z.object({
  phase: BorgingsmomentPhaseEnum,
  name: z.string().trim().min(1).max(255),
  planned_date: z.string(),
  actual_date: z.union([z.string(), z.null()]).optional(),
  responsible_user_id: z.union([z.string().uuid(), z.null()]).optional(),
  notes: z.union([z.string().max(4000), z.null()]).optional(),
  sequence_in_phase: z.number().int().min(0).optional(),
});
export type BorgingsmomentCreateInput = z.infer<typeof BorgingsmomentCreateSchema>;

export const BorgingsmomentUpdateSchema = BorgingsmomentCreateSchema.partial().extend({
  status: BorgingsmomentStatusEnum.optional(),
});
export type BorgingsmomentUpdateInput = z.infer<typeof BorgingsmomentUpdateSchema>;

export const ChecklistItemCreateSchema = z.object({
  description: z.string().trim().min(1).max(4000),
  evidence_type: EvidenceTypeEnum,
  item_type: ChecklistItemTypeEnum.optional(),
  bbl_article_ref: z.union([z.string().max(50), z.null()]).optional(),
  pass_fail_criteria: z.union([z.string().max(4000), z.null()]).optional(),
  sequence: z.number().int().min(0).optional(),
});
export type ChecklistItemCreateInput = z.infer<typeof ChecklistItemCreateSchema>;

export const ChecklistItemUpdateSchema = ChecklistItemCreateSchema.partial();
export type ChecklistItemUpdateInput = z.infer<typeof ChecklistItemUpdateSchema>;

export const MomentReorderSchema = z.object({
  phase: BorgingsmomentPhaseEnum,
  moment_ids: z.array(z.string().uuid()).min(1),
});
export type MomentReorderInput = z.infer<typeof MomentReorderSchema>;

export const ChecklistItemReorderSchema = z.object({
  item_ids: z.array(z.string().uuid()).min(1),
});
export type ChecklistItemReorderInput = z.infer<typeof ChecklistItemReorderSchema>;

export const MomentListSchema = z.array(BorgingsmomentSchema);
export const ChecklistItemListSchema = z.array(ChecklistItemSchema);
