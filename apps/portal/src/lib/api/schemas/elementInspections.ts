import { z } from 'zod';

import {
  BorgingsmomentPhaseEnum,
  BorgingsmomentStatusEnum,
  ChecklistItemSchema,
} from './borgingsplan';
import { ChecklistItemResultSchema } from './inspection';

export const ElementInspectionItemSchema = z.object({
  checklist_item: ChecklistItemSchema,
  result: z.union([ChecklistItemResultSchema, z.null()]),
  moment_name: z.string(),
  moment_phase: BorgingsmomentPhaseEnum,
  moment_status: BorgingsmomentStatusEnum,
});
export type ElementInspectionItem = z.infer<typeof ElementInspectionItemSchema>;

export const ElementInspectionsResponseSchema = z.object({
  items: z.array(ElementInspectionItemSchema),
  element_global_id: z.string(),
  file_id: z.string().uuid(),
});
export type ElementInspectionsResponse = z.infer<typeof ElementInspectionsResponseSchema>;
