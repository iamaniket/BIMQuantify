import { z } from 'zod';

import { ProjectFileListSchema } from '@/lib/api/schemas/files';

// Focused mobile copy. discipline/status as plain strings (display only). The
// `?include=versions` endpoint returns each document with its files, so the list
// screen can resolve the latest ready file id without a second request.
export const DocumentSchema = z.object({
  id: z.string(),
  project_id: z.string(),
  name: z.string(),
  discipline: z.string(),
  status: z.string(),
  primary_file_type: z.union([z.string(), z.null()]).optional(),
});

export const DocumentWithVersionsSchema = DocumentSchema.extend({
  versions: ProjectFileListSchema,
});

export type DocumentWithVersions = z.infer<typeof DocumentWithVersionsSchema>;

export const DocumentWithVersionsListSchema = z.array(DocumentWithVersionsSchema);
export type DocumentWithVersionsList = z.infer<typeof DocumentWithVersionsListSchema>;
