import { z } from 'zod';

import { ProjectFileListSchema } from './files';

export const ModelDisciplineEnum = z.enum([
  'architectural',
  'structural',
  'mep',
  'coordination',
  'other',
]);

export type ModelDisciplineValue = z.infer<typeof ModelDisciplineEnum>;

export const ModelStatusEnum = z.enum(['draft', 'active', 'archived']);

export type ModelStatusValue = z.infer<typeof ModelStatusEnum>;

export const ModelSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  discipline: ModelDisciplineEnum,
  status: ModelStatusEnum,
  created_at: z.string(),
  updated_at: z.string(),
});

export type Model = z.infer<typeof ModelSchema>;

export const ModelListSchema = z.array(ModelSchema);

export type ModelList = z.infer<typeof ModelListSchema>;

export const ModelCreateSchema = z.object({
  name: z.string().min(1).max(255),
  discipline: ModelDisciplineEnum,
  status: ModelStatusEnum.optional(),
});

export type ModelCreateInput = z.infer<typeof ModelCreateSchema>;

export const ModelUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  discipline: ModelDisciplineEnum.optional(),
  status: ModelStatusEnum.optional(),
});

export type ModelUpdateInput = z.infer<typeof ModelUpdateSchema>;

export const ModelWithVersionsSchema = ModelSchema.extend({
  versions: ProjectFileListSchema,
});

export type ModelWithVersions = z.infer<typeof ModelWithVersionsSchema>;
