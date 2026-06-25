import { z } from 'zod';

import { FileTypeEnum, ModelDisciplineEnum } from './common';

// Content-based discipline classification the extractor stamps on each IFC
// file (see apps/processor/src/pipeline/classify.ts). Drives the discipline
// badge and which model supplies the 2D plan in the federated viewer. Null for
// non-IFC files and files extracted before the field existed.
export const DetectedKindEnum = z.enum([
  'architectural',
  'structural',
  'mep',
  'mixed',
  'none',
]);

export type DetectedKindValue = z.infer<typeof DetectedKindEnum>;

export { FileTypeEnum };
export type { FileTypeValue } from './common';

export const IfcSchemaEnum = z.enum(['IFC2X3', 'IFC4', 'IFC4X1', 'IFC4X3', 'unknown']);

export type IfcSchemaValue = z.infer<typeof IfcSchemaEnum>;

export const ProjectFileStatusEnum = z.enum(['pending', 'ready', 'rejected']);

export type ProjectFileStatusValue = z.infer<typeof ProjectFileStatusEnum>;

// Role discriminator on the unified project_files table. Model files served by
// the model-scoped endpoints are always 'model_source'; the field is included
// so the schema matches the API shape.
export const ProjectFileRoleEnum = z.enum(['model_source', 'attachment']);

export type ProjectFileRoleValue = z.infer<typeof ProjectFileRoleEnum>;

export const ExtractionStatusEnum = z.enum([
  'not_started',
  'queued',
  'running',
  'succeeded',
  'failed',
]);

export type ExtractionStatusValue = z.infer<typeof ExtractionStatusEnum>;

export const ProjectFileSchema = z.object({
  id: z.string().uuid(),
  role: ProjectFileRoleEnum,
  document_id: z.string().uuid(),
  project_id: z.string().uuid(),
  version_number: z.number().int().positive(),
  uploaded_by_user_id: z.string().uuid(),
  original_filename: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string(),
  content_sha256: z.union([z.string(), z.null()]),
  ifc_project_guid: z.union([z.string(), z.null()]),
  file_type: FileTypeEnum,
  ifc_schema: z.union([IfcSchemaEnum, z.null()]),
  status: ProjectFileStatusEnum,
  rejection_reason: z.union([z.string(), z.null()]),
  extraction_status: ExtractionStatusEnum,
  extraction_error: z.union([z.string(), z.null()]),
  extraction_started_at: z.union([z.string(), z.null()]),
  extraction_finished_at: z.union([z.string(), z.null()]),
  extractor_version: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectFileListSchema = z.array(ProjectFileSchema);

export type ProjectFileList = z.infer<typeof ProjectFileListSchema>;

export const InitiateUploadRequestSchema = z.object({
  filename: z.string().min(1).max(512),
  size_bytes: z.number().int().positive(),
  content_type: z.string().min(1),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

export type InitiateUploadRequest = z.infer<typeof InitiateUploadRequestSchema>;

export const InitiateUploadResponseSchema = z.object({
  file_id: z.string().uuid(),
  upload_url: z.string().url(),
  storage_key: z.string(),
  expires_in: z.number().int().positive(),
});

export type InitiateUploadResponse = z.infer<typeof InitiateUploadResponseSchema>;

export const ProjectFileDownloadResponseSchema = z.object({
  download_url: z.string().url(),
  expires_in: z.number().int().positive(),
});

export type ProjectFileDownloadResponse = z.infer<typeof ProjectFileDownloadResponseSchema>;

export const ViewerBundleResponseSchema = z.object({
  file_type: FileTypeEnum,
  fragments_url: z.union([z.string().url(), z.null()]),
  fragments_key: z.union([z.string(), z.null()]),
  metadata_url: z.union([z.string().url(), z.null()]),
  properties_url: z.union([z.string().url(), z.null()]),
  geometry_url: z.union([z.string().url(), z.null()]),
  outline_url: z.union([z.string().url(), z.null()]),
  floor_plans_url: z.union([z.string().url(), z.null()]),
  file_url: z.union([z.string().url(), z.null()]),
  expires_in: z.number().int().positive(),
});

export type ViewerBundleResponse = z.infer<typeof ViewerBundleResponseSchema>;

// One document in a project's federated viewer manifest: the latest ready IFC
// file for a document plus its presigned artifact URLs and discipline metadata.
export const ProjectViewerDocumentEntrySchema = z.object({
  file_id: z.string().uuid(),
  model_id: z.string().uuid(),
  model_name: z.string(),
  discipline: ModelDisciplineEnum,
  detected_kind: z.union([DetectedKindEnum, z.null()]),
  fragments_url: z.union([z.string().url(), z.null()]),
  fragments_key: z.union([z.string(), z.null()]),
  metadata_url: z.union([z.string().url(), z.null()]),
  properties_url: z.union([z.string().url(), z.null()]),
  outline_url: z.union([z.string().url(), z.null()]),
  floor_plans_url: z.union([z.string().url(), z.null()]),
});

export type ProjectViewerDocumentEntry = z.infer<typeof ProjectViewerDocumentEntrySchema>;

export const ProjectViewerManifestResponseSchema = z.object({
  expires_in: z.number().int().positive(),
  models: z.array(ProjectViewerDocumentEntrySchema),
});

export type ProjectViewerManifestResponse = z.infer<typeof ProjectViewerManifestResponseSchema>;
