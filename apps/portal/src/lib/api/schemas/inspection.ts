import { z } from 'zod';

export const InspectionVerdictEnum = z.enum(['pass', 'fail', 'not_applicable']);
export type InspectionVerdictValue = z.infer<typeof InspectionVerdictEnum>;

export const ChecklistItemResultSchema = z.object({
  id: z.string().uuid(),
  checklist_item_id: z.string().uuid(),
  borgingsmoment_id: z.string().uuid(),
  project_id: z.string().uuid(),
  verdict: InspectionVerdictEnum,
  note: z.union([z.string(), z.null()]),
  inspector_user_id: z.string().uuid(),
  inspected_at: z.string(),
  photo_ids: z.union([z.array(z.string()), z.null()]),
  reference_attachment_ids: z.union([z.array(z.string()), z.null()]),
  voice_note_id: z.union([z.string().uuid(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ChecklistItemResult = z.infer<typeof ChecklistItemResultSchema>;

export const ChecklistItemResultListSchema = z.array(ChecklistItemResultSchema);

export const InspectionSummarySchema = z.object({
  total_items: z.number().int(),
  completed: z.number().int(),
  passed: z.number().int(),
  failed: z.number().int(),
  not_applicable: z.number().int(),
  remaining: z.number().int(),
});
export type InspectionSummary = z.infer<typeof InspectionSummarySchema>;

export const ResultCreateSchema = z.object({
  verdict: InspectionVerdictEnum,
  note: z.union([z.string().max(4000), z.null()]).optional(),
  photo_ids: z.union([z.array(z.string()), z.null()]).optional(),
  reference_attachment_ids: z.union([z.array(z.string()), z.null()]).optional(),
});
export type ResultCreateInput = z.infer<typeof ResultCreateSchema>;
