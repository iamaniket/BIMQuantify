import { z } from 'zod';

import { FileTypeEnum, ModelDisciplineEnum } from './common';
import { ProjectFileListSchema } from './files';

export { ModelDisciplineEnum };
export type { ModelDisciplineValue } from './common';

export const ModelStatusEnum = z.enum(['draft', 'active', 'archived']);

export type ModelStatusValue = z.infer<typeof ModelStatusEnum>;

export const ModelSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  discipline: ModelDisciplineEnum,
  status: ModelStatusEnum,
  primary_file_type: FileTypeEnum.nullable().optional(),
  // Current-revision pointer (F7). NULL/absent → head is the newest version;
  // when set, this file id is the model's head (view / compliance / "current"
  // badge all target it).
  head_file_id: z.string().uuid().nullable().optional(),
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

export const ModelWithVersionsListSchema = z.array(ModelWithVersionsSchema);

export type ModelWithVersionsList = z.infer<typeof ModelWithVersionsListSchema>;
