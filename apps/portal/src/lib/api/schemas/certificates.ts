import { z } from 'zod';

export const CertificateTypeEnum = z.enum([
  'product',
  'installation_test',
  'inspection',
  'warranty',
  'other',
]);
export type CertificateTypeValue = z.infer<typeof CertificateTypeEnum>;

export const CertificateStatusEnum = z.enum(['pending', 'ready', 'rejected']);
export type CertificateStatusValue = z.infer<typeof CertificateStatusEnum>;

export const CertificateSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  uploaded_by_user_id: z.union([z.string().uuid(), z.null()]),
  uploaded_by_name: z.union([z.string(), z.null()]),
  original_filename: z.string(),
  size_bytes: z.number(),
  content_type: z.string(),
  content_sha256: z.union([z.string(), z.null()]),
  certificate_type: CertificateTypeEnum,
  status: CertificateStatusEnum,
  rejection_reason: z.union([z.string(), z.null()]),
  description: z.union([z.string(), z.null()]),
  certificate_number: z.union([z.string(), z.null()]),
  issuer: z.union([z.string(), z.null()]),
  subject: z.union([z.string(), z.null()]),
  valid_from: z.union([z.string(), z.null()]),
  valid_until: z.union([z.string(), z.null()]),
  org_certificate_id: z.union([z.string().uuid(), z.null()]),
  version_number: z.number(),
  parent_certificate_id: z.union([z.string().uuid(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Certificate = z.infer<typeof CertificateSchema>;

export const CertificateListSchema = z.array(CertificateSchema);
export type CertificateList = z.infer<typeof CertificateListSchema>;

export const CertificateInitiateResponseSchema = z.object({
  certificate_id: z.string().uuid(),
  upload_url: z.string(),
  storage_key: z.string(),
  expires_in: z.number(),
});
export type CertificateInitiateResponse = z.infer<typeof CertificateInitiateResponseSchema>;

export const CertificateDownloadResponseSchema = z.object({
  download_url: z.string(),
  expires_in: z.number(),
});
export type CertificateDownloadResponse = z.infer<typeof CertificateDownloadResponseSchema>;
