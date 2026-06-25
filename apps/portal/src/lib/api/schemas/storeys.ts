import { z } from 'zod';

export const StoreySchema = z.object({
  id: z.string().uuid(),
  model_id: z.string().uuid(),
  // The shared project Level this storey reconciles onto (null until reconciled).
  level_id: z.string().uuid().nullable(),
  name: z.string().nullable(),
  elevation_m: z.number().nullable(),
  ifc_guid: z.string().nullable(),
  express_id: z.number().int().nullable(),
  ordering: z.number().int().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Storey = z.infer<typeof StoreySchema>;

export const StoreyListSchema = z.array(StoreySchema);

export type StoreyList = z.infer<typeof StoreyListSchema>;
