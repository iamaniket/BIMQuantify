import { z } from 'zod';

export const LevelSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  elevation_m: z.number().nullable(),
  ordering: z.number().int().nullable(),
  // 'manual' (user-created) | 'ifc' (extraction-reconciled).
  source: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Level = z.infer<typeof LevelSchema>;

export const LevelListSchema = z.array(LevelSchema);

export type LevelList = z.infer<typeof LevelListSchema>;

export const LevelCreateSchema = z.object({
  name: z.string().min(1).max(255),
  elevation_m: z.number().nullable().optional(),
  ordering: z.number().int().nullable().optional(),
});

export type LevelCreateInput = z.infer<typeof LevelCreateSchema>;

export const LevelUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  elevation_m: z.number().nullable().optional(),
  ordering: z.number().int().nullable().optional(),
});

export type LevelUpdateInput = z.infer<typeof LevelUpdateSchema>;
