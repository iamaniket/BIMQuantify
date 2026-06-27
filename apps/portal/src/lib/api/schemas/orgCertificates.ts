import { z } from 'zod';

import { CertificateStatusEnum, CertificateTypeEnum } from './certificates';
import { httpUrlString } from './url';

export const OrgCertificateSchema = z.object({
  id: z.string().uuid(),
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
  product_name: z.union([z.string(), z.null()]),
  supplier_name: z.union([z.string(), z.null()]),
  replaced_by_id: z.union([z.string().uuid(), z.null()]),
  tags: z.union([z.array(z.string()), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});
export type OrgCertificate = z.infer<typeof OrgCertificateSchema>;

export const OrgCertificateListSchema = z.array(OrgCertificateSchema);
export type OrgCertificateList = z.infer<typeof OrgCertificateListSchema>;

export const OrgCertificateInitiateResponseSchema = z.object({
  certificate_id: z.string().uuid(),
  upload_url: z.string(),
  storage_key: z.string(),
  expires_in: z.number(),
});
export type OrgCertificateInitiateResponse = z.infer<typeof OrgCertificateInitiateResponseSchema>;

export const OrgCertificateDownloadResponseSchema = z.object({
  download_url: httpUrlString,
  expires_in: z.number(),
});
export type OrgCertificateDownloadResponse = z.infer<typeof OrgCertificateDownloadResponseSchema>;

export const OrgCertificateStatsSchema = z.object({
  total: z.number(),
  expiring_soon: z.number(),
  expired: z.number(),
});
export type OrgCertificateStats = z.infer<typeof OrgCertificateStatsSchema>;
