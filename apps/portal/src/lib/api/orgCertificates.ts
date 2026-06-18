import { computeFileSha256 } from '../upload/sha256';
import { apiClient, type PaginatedResponse } from './client';
import {
  CertificateSchema,
  type Certificate,
  type CertificateTypeValue,
} from './schemas/certificates';
import {
  OrgCertificateDownloadResponseSchema,
  OrgCertificateInitiateResponseSchema,
  OrgCertificateListSchema,
  OrgCertificateSchema,
  OrgCertificateStatsSchema,
  type OrgCertificate,
  type OrgCertificateDownloadResponse,
  type OrgCertificateInitiateResponse,
  type OrgCertificateList,
  type OrgCertificateStats,
} from './schemas/orgCertificates';

export type OrgCertificateUploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

export type OrgCertificateMetadataInput = {
  certificate_type: CertificateTypeValue;
  certificate_number?: string | null;
  issuer?: string | null;
  subject?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  description?: string | null;
  product_name?: string | null;
  supplier_name?: string | null;
  tags?: string[] | null;
};

export async function initiateOrgCertificateUpload(
  accessToken: string,
  input: OrgCertificateMetadataInput & {
    filename: string;
    size_bytes: number;
    content_type: string;
    content_sha256: string;
  },
): Promise<OrgCertificateInitiateResponse> {
  return apiClient.post<OrgCertificateInitiateResponse>(
    '/org-certificates/initiate',
    input,
    OrgCertificateInitiateResponseSchema,
    accessToken,
  );
}

export async function completeOrgCertificateUpload(
  accessToken: string,
  certificateId: string,
): Promise<OrgCertificate> {
  return apiClient.post<OrgCertificate>(
    `/org-certificates/${certificateId}/complete`,
    {},
    OrgCertificateSchema,
    accessToken,
  );
}

export async function listOrgCertificates(
  accessToken: string,
  filters?: {
    certificateType?: CertificateTypeValue;
    search?: string;
    expiringBefore?: string;
    expired?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<OrgCertificateList> {
  const params = new URLSearchParams();
  if (filters?.certificateType !== undefined) params.set('certificate_type', filters.certificateType);
  if (filters?.search !== undefined && filters.search.length > 0) params.set('search', filters.search);
  if (filters?.expiringBefore !== undefined) params.set('expiring_before', filters.expiringBefore);
  if (filters?.expired === true) params.set('expired', 'true');
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<OrgCertificateList>(
    `/org-certificates${query}`,
    OrgCertificateListSchema,
    accessToken,
  );
}

export type ListOrgCertificatesFilters = {
  certificateType?: CertificateTypeValue | undefined;
  search?: string | undefined;
  expiringBefore?: string | undefined;
  expired?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  order_by?: string | undefined;
  order_dir?: 'asc' | 'desc' | undefined;
};

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listOrgCertificatesPage(
  accessToken: string,
  filters?: ListOrgCertificatesFilters,
): Promise<PaginatedResponse<OrgCertificateList>> {
  const params = new URLSearchParams();
  if (filters?.certificateType !== undefined) params.set('certificate_type', filters.certificateType);
  if (filters?.search !== undefined && filters.search.length > 0) params.set('search', filters.search);
  if (filters?.expiringBefore !== undefined) params.set('expiring_before', filters.expiringBefore);
  if (filters?.expired === true) params.set('expired', 'true');
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  if (filters?.order_by !== undefined) params.set('order_by', filters.order_by);
  if (filters?.order_dir !== undefined) params.set('order_dir', filters.order_dir);
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.getWithMeta<OrgCertificateList>(
    `/org-certificates${query}`,
    OrgCertificateListSchema,
    accessToken,
  );
}

export async function getOrgCertificateStats(
  accessToken: string,
): Promise<OrgCertificateStats> {
  return apiClient.get<OrgCertificateStats>(
    '/org-certificates/stats',
    OrgCertificateStatsSchema,
    accessToken,
  );
}

export async function getOrgCertificateDownloadUrl(
  accessToken: string,
  certificateId: string,
): Promise<OrgCertificateDownloadResponse> {
  return apiClient.get<OrgCertificateDownloadResponse>(
    `/org-certificates/${certificateId}/download`,
    OrgCertificateDownloadResponseSchema,
    accessToken,
  );
}

export async function getOrgCertificateViewUrl(
  accessToken: string,
  certificateId: string,
): Promise<OrgCertificateDownloadResponse> {
  return apiClient.get<OrgCertificateDownloadResponse>(
    `/org-certificates/${certificateId}/download?disposition=inline`,
    OrgCertificateDownloadResponseSchema,
    accessToken,
  );
}

export async function updateOrgCertificate(
  accessToken: string,
  certificateId: string,
  input: Partial<OrgCertificateMetadataInput>,
): Promise<OrgCertificate> {
  return apiClient.patch<OrgCertificate>(
    `/org-certificates/${certificateId}`,
    input,
    OrgCertificateSchema,
    accessToken,
  );
}

export async function deleteOrgCertificate(
  accessToken: string,
  certificateId: string,
): Promise<void> {
  return apiClient.delete(`/org-certificates/${certificateId}`, accessToken);
}

export async function uploadOrgCertificateEnd2End(
  accessToken: string,
  file: File,
  metadata: OrgCertificateMetadataInput,
  onProgress?: (event: OrgCertificateUploadProgressEvent) => void,
): Promise<OrgCertificate> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const contentType = file.type === '' ? 'application/octet-stream' : file.type;
  const initResponse = await initiateOrgCertificateUpload(accessToken, {
    filename: file.name,
    size_bytes: file.size,
    content_type: contentType,
    content_sha256: contentSha256,
    ...metadata,
  });
  await apiClient.putRaw(initResponse.upload_url, file, contentType);

  onProgress?.({ phase: 'completing' });
  return completeOrgCertificateUpload(accessToken, initResponse.certificate_id);
}

export async function linkFromLibrary(
  accessToken: string,
  projectId: string,
  orgCertificateId: string,
): Promise<Certificate> {
  return apiClient.post<Certificate>(
    `/projects/${projectId}/certificates/link-from-library`,
    { org_certificate_id: orgCertificateId },
    CertificateSchema,
    accessToken,
  );
}
