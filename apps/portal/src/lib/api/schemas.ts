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

export const ProjectStatusEnum = z.enum([
  'planning',
  'ontwerp',
  'vergunning',
  'uitvoering',
  'oplevering',
  'gereed',
  'on_hold',
]);

export type ProjectStatusValue = z.infer<typeof ProjectStatusEnum>;

export const ProjectPhaseEnum = z.enum([
  'ontwerp',
  'bestek',
  'werkvoorbereiding',
  'ruwbouw',
  'afbouw',
  'oplevering',
]);

export type ProjectPhaseValue = z.infer<typeof ProjectPhaseEnum>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  thumbnail_url: z.union([z.string(), z.null()]),
  owner_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),

  reference_code: z.union([z.string(), z.null()]),
  status: ProjectStatusEnum,
  phase: ProjectPhaseEnum,
  delivery_date: z.union([z.string(), z.null()]),

  street: z.union([z.string(), z.null()]),
  house_number: z.union([z.string(), z.null()]),
  postal_code: z.union([z.string(), z.null()]),
  city: z.union([z.string(), z.null()]),
  municipality: z.union([z.string(), z.null()]),
  bag_id: z.union([z.string(), z.null()]),
  permit_number: z.union([z.string(), z.null()]),

  latitude: z.union([z.number(), z.null()]),
  longitude: z.union([z.number(), z.null()]),

  contractor_id: z.union([z.string().uuid(), z.null()]),
  contractor_name: z.union([z.string(), z.null()]),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

export type ProjectList = z.infer<typeof ProjectListSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.union([z.string(), z.null()]).optional(),
  reference_code: z.union([z.string().max(50), z.null()]).optional(),
  status: ProjectStatusEnum.optional(),
  phase: ProjectPhaseEnum.optional(),
  delivery_date: z.union([z.string(), z.null()]).optional(),
  street: z.union([z.string().max(255), z.null()]).optional(),
  house_number: z.union([z.string().max(20), z.null()]).optional(),
  postal_code: z.union([z.string().max(7), z.null()]).optional(),
  city: z.union([z.string().max(255), z.null()]).optional(),
  municipality: z.union([z.string().max(255), z.null()]).optional(),
  bag_id: z.union([z.string().max(50), z.null()]).optional(),
  permit_number: z.union([z.string().max(100), z.null()]).optional(),
  latitude: z.union([z.number().min(-90).max(90), z.null()]).optional(),
  longitude: z.union([z.number().min(-180).max(180), z.null()]).optional(),
  contractor_id: z.union([z.string().uuid(), z.null()]).optional(),
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial();

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

export const ContractorSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  kvk_number: z.union([z.string(), z.null()]),
  contact_email: z.union([z.string(), z.null()]),
  contact_phone: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Contractor = z.infer<typeof ContractorSchema>;

export const ContractorListSchema = z.array(ContractorSchema);

export type ContractorList = z.infer<typeof ContractorListSchema>;

export const ContractorCreateSchema = z.object({
  name: z.string().min(1).max(255),
  kvk_number: z.union([z.string().max(20), z.null()]).optional(),
  contact_email: z.union([z.string().max(320), z.null()]).optional(),
  contact_phone: z.union([z.string().max(50), z.null()]).optional(),
});

export type ContractorCreateInput = z.infer<typeof ContractorCreateSchema>;

export const ContractorUpdateSchema = ContractorCreateSchema.partial();

export type ContractorUpdateInput = z.infer<typeof ContractorUpdateSchema>;

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
  version_number: z.number().int().positive(),
  uploaded_by_user_id: z.string().uuid(),
  original_filename: z.string(),
  size_bytes: z.number().int().nonnegative(),
  content_type: z.string(),
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
  metadata_url: z.union([z.string().url(), z.null()]),
  properties_url: z.union([z.string().url(), z.null()]),
  file_url: z.union([z.string().url(), z.null()]),
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
