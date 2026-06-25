import { z } from 'zod';

import { FileTypeEnum, ModelDisciplineEnum } from './common';
import { ProjectFileListSchema } from './files';

export { ModelDisciplineEnum };
export type { ModelDisciplineValue } from './common';

export const DocumentStatusEnum = z.enum(['draft', 'active', 'archived']);

export type DocumentStatusValue = z.infer<typeof DocumentStatusEnum>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  discipline: ModelDisciplineEnum,
  status: DocumentStatusEnum,
  primary_file_type: FileTypeEnum.nullable().optional(),
  // The project Level a 2D drawing belongs to (null = Unassigned / IFC).
  level_id: z.string().uuid().nullable().optional(),
  // Current-revision pointer (F7). NULL/absent → head is the newest version;
  // when set, this file id is the document's head (view / compliance / "current"
  // badge all target it).
  head_file_id: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListSchema = z.array(DocumentSchema);

export type DocumentList = z.infer<typeof DocumentListSchema>;

export const DocumentCreateSchema = z.object({
  name: z.string().min(1).max(255),
  // Optional at creation — the server defaults it to "other" and the user sets
  // the real discipline later from the document row.
  discipline: ModelDisciplineEnum.optional(),
  status: DocumentStatusEnum.optional(),
});

export type DocumentCreateInput = z.infer<typeof DocumentCreateSchema>;

export const DocumentUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  discipline: ModelDisciplineEnum.optional(),
  status: DocumentStatusEnum.optional(),
  // Assign / move a 2D drawing to a level, or null to detach (Unassigned).
  level_id: z.string().uuid().nullable().optional(),
});

export type DocumentUpdateInput = z.infer<typeof DocumentUpdateSchema>;

export const DocumentWithVersionsSchema = DocumentSchema.extend({
  versions: ProjectFileListSchema,
});

export type DocumentWithVersions = z.infer<typeof DocumentWithVersionsSchema>;

export const DocumentWithVersionsListSchema = z.array(DocumentWithVersionsSchema);

export type DocumentWithVersionsList = z.infer<typeof DocumentWithVersionsListSchema>;
