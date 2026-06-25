import { computeFileSha256 } from '../upload/sha256';
import { apiClient, type PaginatedResponse } from './client';
import {
  CertificateDownloadResponseSchema,
  CertificateInitiateResponseSchema,
  CertificateListSchema,
  CertificateSchema,
  type Certificate,
  type CertificateDownloadResponse,
  type CertificateInitiateResponse,
  type CertificateList,
  type CertificateTypeValue,
  type LinkedFileTypeValue,
} from './schemas';

export type CertificateUploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

export type CertificateMetadataInput = {
  certificate_type: CertificateTypeValue;
  certificate_number?: string | null;
  issuer?: string | null;
  subject?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  description?: string | null;
  linked_element_global_id?: string | null;
  linked_document_id?: string | null;
  linked_file_id?: string | null;
  linked_file_type?: LinkedFileTypeValue | null;
  anchor_x?: number | null;
  anchor_y?: number | null;
  anchor_z?: number | null;
  anchor_page?: number | null;
  // Supersede an existing certificate: the upload becomes the next version in
  // that certificate's version group instead of a fresh root (#35).
  supersedes_id?: string | null;
};

export async function initiateCertificateUpload(
  accessToken: string,
  projectId: string,
  input: CertificateMetadataInput & {
    filename: string;
    size_bytes: number;
    content_type: string;
    content_sha256: string;
  },
): Promise<CertificateInitiateResponse> {
  return apiClient.post<CertificateInitiateResponse>(
    `/projects/${projectId}/certificates/initiate`,
    input,
    CertificateInitiateResponseSchema,
    accessToken,
  );
}

export async function completeCertificateUpload(
  accessToken: string,
  projectId: string,
  certificateId: string,
): Promise<Certificate> {
  return apiClient.post<Certificate>(
    `/projects/${projectId}/certificates/${certificateId}/complete`,
    {},
    CertificateSchema,
    accessToken,
  );
}

export async function listCertificates(
  accessToken: string,
  projectId: string,
  filters?: {
    certificateType?: CertificateTypeValue;
    linkedElementGlobalId?: string;
    linkedModelId?: string;
    linkedFileId?: string;
    unlinked?: boolean;
    expiringBefore?: string;
    expired?: boolean;
    limit?: number;
    offset?: number;
  },
): Promise<PaginatedResponse<CertificateList>> {
  const params = new URLSearchParams();
  if (filters?.certificateType !== undefined) params.set('certificate_type', filters.certificateType);
  if (filters?.linkedElementGlobalId !== undefined) params.set('linked_element_global_id', filters.linkedElementGlobalId);
  if (filters?.linkedModelId !== undefined) params.set('linked_document_id', filters.linkedModelId);
  if (filters?.linkedFileId !== undefined) params.set('linked_file_id', filters.linkedFileId);
  if (filters?.unlinked === true) params.set('unlinked', 'true');
  if (filters?.expiringBefore !== undefined) params.set('expiring_before', filters.expiringBefore);
  if (filters?.expired === true) params.set('expired', 'true');
  if (filters?.limit !== undefined) params.set('limit', String(filters.limit));
  if (filters?.offset !== undefined) params.set('offset', String(filters.offset));
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.getWithMeta<CertificateList>(
    `/projects/${projectId}/certificates${query}`,
    CertificateListSchema,
    accessToken,
  );
}

export async function getCertificateDownloadUrl(
  accessToken: string,
  projectId: string,
  certificateId: string,
): Promise<CertificateDownloadResponse> {
  return apiClient.get<CertificateDownloadResponse>(
    `/projects/${projectId}/certificates/${certificateId}/download`,
    CertificateDownloadResponseSchema,
    accessToken,
  );
}

/** Inline-disposition presigned URL for previewing a certificate in-browser. */
export async function getCertificateViewUrl(
  accessToken: string,
  projectId: string,
  certificateId: string,
): Promise<CertificateDownloadResponse> {
  return apiClient.get<CertificateDownloadResponse>(
    `/projects/${projectId}/certificates/${certificateId}/download?disposition=inline`,
    CertificateDownloadResponseSchema,
    accessToken,
  );
}

export async function updateCertificate(
  accessToken: string,
  projectId: string,
  certificateId: string,
  input: Partial<CertificateMetadataInput>,
): Promise<Certificate> {
  return apiClient.patch<Certificate>(
    `/projects/${projectId}/certificates/${certificateId}`,
    input,
    CertificateSchema,
    accessToken,
  );
}

export async function deleteCertificate(
  accessToken: string,
  projectId: string,
  certificateId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/certificates/${certificateId}`, accessToken);
}

export async function uploadCertificateEnd2End(
  accessToken: string,
  projectId: string,
  file: File,
  metadata: CertificateMetadataInput,
  onProgress?: (event: CertificateUploadProgressEvent) => void,
): Promise<Certificate> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const contentType = file.type === '' ? 'application/octet-stream' : file.type;
  const initResponse = await initiateCertificateUpload(accessToken, projectId, {
    filename: file.name,
    size_bytes: file.size,
    content_type: contentType,
    content_sha256: contentSha256,
    ...metadata,
  });
  await apiClient.putRaw(initResponse.upload_url, file, contentType);

  onProgress?.({ phase: 'completing' });
  return completeCertificateUpload(accessToken, projectId, initResponse.certificate_id);
}
