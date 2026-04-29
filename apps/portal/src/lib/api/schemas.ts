import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenPairSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().min(1),
});

export type TokenPair = z.infer<typeof TokenPairSchema>;

export const UserReadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  is_verified: z.boolean(),
  full_name: z.union([z.string(), z.null()]),
  organization_id: z.union([z.string(), z.null()]),
});

export type UserRead = z.infer<typeof UserReadSchema>;

export const ApiErrorBodySchema = z.object({
  detail: z.union([z.string(), z.array(z.unknown()), z.record(z.unknown())]),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  thumbnail_url: z.union([z.string(), z.null()]),
  owner_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

export type ProjectList = z.infer<typeof ProjectListSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.union([z.string(), z.null()]).optional(),
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial();

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

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
  version_number: z.number().int().positive(),
  uploaded_by_user_id: z.string().uuid(),
  original_filename: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string(),
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
  fragments_url: z.string().url(),
  metadata_url: z.union([z.string().url(), z.null()]),
  properties_url: z.union([z.string().url(), z.null()]),
  expires_in: z.number().int().positive(),
});

export type ViewerBundleResponse = z.infer<typeof ViewerBundleResponseSchema>;

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
