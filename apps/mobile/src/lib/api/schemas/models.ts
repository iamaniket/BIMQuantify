import { z } from 'zod';

import { ProjectFileListSchema } from '@/lib/api/schemas/files';

// Focused mobile copy. discipline/status as plain strings (display only). The
// `?include=versions` endpoint returns each model with its files, so the list
// screen can resolve the latest ready file id without a second request.
export const ModelSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  discipline: z.string(),
  status: z.string(),
  primary_file_type: z.union([z.string(), z.null()]).optional(),
});

export const ModelWithVersionsSchema = ModelSchema.extend({
  versions: ProjectFileListSchema,
});

export type ModelWithVersions = z.infer<typeof ModelWithVersionsSchema>;

export const ModelWithVersionsListSchema = z.array(ModelWithVersionsSchema);
export type ModelWithVersionsList = z.infer<typeof ModelWithVersionsListSchema>;
