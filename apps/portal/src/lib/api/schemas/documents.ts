import { z } from 'zod';

export const DocumentCategoryEnum = z.enum(['image', 'video', 'audio', 'office', 'other']);
export type DocumentCategoryValue = z.infer<typeof DocumentCategoryEnum>;

export const DocumentStatusEnum = z.enum(['pending', 'ready', 'rejected']);
export type DocumentStatusValue = z.infer<typeof DocumentStatusEnum>;

export const DocumentSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  uploaded_by_user_id: z.union([z.string().uuid(), z.null()]),
  capture_link_id: z.union([z.string().uuid(), z.null()]),
  original_filename: z.string(),
  size_bytes: z.number(),
  content_type: z.string(),
  content_sha256: z.union([z.string(), z.null()]),
  document_category: DocumentCategoryEnum,
  status: DocumentStatusEnum,
  rejection_reason: z.union([z.string(), z.null()]),
  description: z.union([z.string(), z.null()]),
  linked_element_global_id: z.union([z.string(), z.null()]),
  linked_model_id: z.union([z.string().uuid(), z.null()]),
  linked_point: z.union([z.record(z.unknown()), z.null()]),
  linked_file_id: z.union([z.string().uuid(), z.null()]),
  version_number: z.number(),
  parent_document_id: z.union([z.string().uuid(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListSchema = z.array(DocumentSchema);
export type DocumentList = z.infer<typeof DocumentListSchema>;

export const DocumentInitiateResponseSchema = z.object({
  document_id: z.string().uuid(),
  upload_url: z.string(),
  storage_key: z.string(),
  expires_in: z.number(),
});
export type DocumentInitiateResponse = z.infer<typeof DocumentInitiateResponseSchema>;

export const DocumentDownloadResponseSchema = z.object({
  download_url: z.string(),
  expires_in: z.number(),
});
export type DocumentDownloadResponse = z.infer<typeof DocumentDownloadResponseSchema>;

// --- Capture Links ---

export const CaptureLinkSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  created_by_user_id: z.string().uuid(),
  label: z.union([z.string(), z.null()]),
  expires_at: z.string(),
  revoked_at: z.union([z.string(), z.null()]),
  max_uses: z.union([z.number(), z.null()]),
  use_count: z.number(),
  created_at: z.string(),
});
export type CaptureLink = z.infer<typeof CaptureLinkSchema>;

export const CaptureLinkListSchema = z.array(CaptureLinkSchema);
export type CaptureLinkList = z.infer<typeof CaptureLinkListSchema>;

export const CreateCaptureLinkResponseSchema = z.object({
  id: z.string().uuid(),
  token: z.string(),
  url: z.string(),
  expires_at: z.string(),
  label: z.union([z.string(), z.null()]),
  max_uses: z.union([z.number(), z.null()]),
});
export type CreateCaptureLinkResponse = z.infer<typeof CreateCaptureLinkResponseSchema>;

// --- Public capture validation ---

export const CaptureTokenValidationSchema = z.object({
  project_id: z.string().uuid(),
  project_name: z.string(),
  label: z.union([z.string(), z.null()]),
  expires_at: z.string(),
  remaining_uses: z.union([z.number(), z.null()]),
});
export type CaptureTokenValidation = z.infer<typeof CaptureTokenValidationSchema>;

export const CaptureUploadResponseSchema = z.object({
  document_id: z.string().uuid(),
  upload_url: z.string(),
  storage_key: z.string(),
  expires_in: z.number(),
});
export type CaptureUploadResponse = z.infer<typeof CaptureUploadResponseSchema>;

export const CaptureCompleteResponseSchema = z.object({
  status: z.string(),
  document_id: z.string(),
});
export type CaptureCompleteResponse = z.infer<typeof CaptureCompleteResponseSchema>;
