import { z } from 'zod';

export const FileTypeEnum = z.enum(['ifc', 'pdf']);

export type FileTypeValue = z.infer<typeof FileTypeEnum>;

export const IfcSchemaEnum = z.enum(['IFC2X3', 'IFC4', 'IFC4X1', 'IFC4X3', 'unknown']);

export type IfcSchemaValue = z.infer<typeof IfcSchemaEnum>;

export const ProjectFileStatusEnum = z.enum(['pending', 'ready', 'rejected']);

export type ProjectFileStatusValue = z.infer<typeof ProjectFileStatusEnum>;

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
  model_id: z.string().uuid(),
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
  file_url: z.union([z.string().url(), z.null()]),
  expires_in: z.number().int().positive(),
});

export type ViewerBundleResponse = z.infer<typeof ViewerBundleResponseSchema>;
