import { computeFileSha256 } from '../upload/sha256';
import { apiClient } from './client';
import {
  CaptureLinkListSchema,
  CreateCaptureLinkResponseSchema,
  AttachmentDownloadResponseSchema,
  AttachmentInitiateResponseSchema,
  AttachmentListSchema,
  AttachmentSchema,
  type CaptureLink,
  type CaptureLinkList,
  type CreateCaptureLinkResponse,
  type Attachment,
  type AttachmentCategoryValue,
  type AttachmentDownloadResponse,
  type AttachmentInitiateResponse,
  type AttachmentList,
} from './schemas';

export type AttachmentUploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

// ---------------------------------------------------------------------------
// Attachments (authenticated)
// ---------------------------------------------------------------------------

export async function initiateAttachmentUpload(
  accessToken: string,
  projectId: string,
  input: {
    filename: string;
    size_bytes: number;
    content_type: string;
    content_sha256: string;
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
    capture_metadata?: Record<string, unknown> | null;
  },
): Promise<AttachmentInitiateResponse> {
  return apiClient.post<AttachmentInitiateResponse>(
    `/projects/${projectId}/attachments/initiate`,
    input,
    AttachmentInitiateResponseSchema,
    accessToken,
  );
}

export async function completeAttachmentUpload(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<Attachment> {
  return apiClient.post<Attachment>(
    `/projects/${projectId}/attachments/${attachmentId}/complete`,
    {},
    AttachmentSchema,
    accessToken,
  );
}

export async function listAttachments(
  accessToken: string,
  projectId: string,
  filters?: {
    category?: AttachmentCategoryValue;
    linkedElementGlobalId?: string;
    linkedFileId?: string;
    unlinked?: boolean;
    linkedPointType?: string;
    linkedPointPage?: number;
  },
): Promise<AttachmentList> {
  const params = new URLSearchParams();
  if (filters?.category !== undefined) params.set('category', filters.category);
  if (filters?.linkedElementGlobalId !== undefined) params.set('linked_element_global_id', filters.linkedElementGlobalId);
  if (filters?.linkedFileId !== undefined) params.set('linked_file_id', filters.linkedFileId);
  if (filters?.unlinked === true) params.set('unlinked', 'true');
  if (filters?.linkedPointType !== undefined) params.set('linked_point_type', filters.linkedPointType);
  if (filters?.linkedPointPage !== undefined) params.set('linked_point_page', String(filters.linkedPointPage));
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<AttachmentList>(
    `/projects/${projectId}/attachments${query}`,
    AttachmentListSchema,
    accessToken,
  );
}

export async function getAttachment(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<Attachment> {
  return apiClient.get<Attachment>(
    `/projects/${projectId}/attachments/${attachmentId}`,
    AttachmentSchema,
    accessToken,
  );
}

export async function getAttachmentDownloadUrl(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get<AttachmentDownloadResponse>(
    `/projects/${projectId}/attachments/${attachmentId}/download`,
    AttachmentDownloadResponseSchema,
    accessToken,
  );
}

export async function getAttachmentViewUrl(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get<AttachmentDownloadResponse>(
    `/projects/${projectId}/attachments/${attachmentId}/download?disposition=inline`,
    AttachmentDownloadResponseSchema,
    accessToken,
  );
}

export async function updateAttachment(
  accessToken: string,
  projectId: string,
  attachmentId: string,
  input: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
  },
): Promise<Attachment> {
  return apiClient.patch<Attachment>(
    `/projects/${projectId}/attachments/${attachmentId}`,
    input,
    AttachmentSchema,
    accessToken,
  );
}

export async function deleteAttachment(
  accessToken: string,
  projectId: string,
  attachmentId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/attachments/${attachmentId}`, accessToken);
}

export async function uploadAttachmentEnd2End(
  accessToken: string,
  projectId: string,
  file: File,
  extra?: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
    capture_metadata?: Record<string, unknown> | null;
  },
  onProgress?: (event: AttachmentUploadProgressEvent) => void,
): Promise<Attachment> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const initResponse = await initiateAttachmentUpload(accessToken, projectId, {
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type === '' ? 'application/octet-stream' : file.type,
    content_sha256: contentSha256,
    ...extra,
  });
  await apiClient.putRaw(
    initResponse.upload_url,
    file,
    file.type === '' ? 'application/octet-stream' : file.type,
  );

  onProgress?.({ phase: 'completing' });
  return completeAttachmentUpload(accessToken, projectId, initResponse.attachment_id);
}

// ---------------------------------------------------------------------------
// Capture links (authenticated)
// ---------------------------------------------------------------------------

export async function createCaptureLink(
  accessToken: string,
  projectId: string,
  input: {
    label?: string | null;
    ttl_hours?: number;
    max_uses?: number | null;
  },
): Promise<CreateCaptureLinkResponse> {
  return apiClient.post<CreateCaptureLinkResponse>(
    `/projects/${projectId}/capture-links`,
    input,
    CreateCaptureLinkResponseSchema,
    accessToken,
  );
}

export async function listCaptureLinks(
  accessToken: string,
  projectId: string,
): Promise<CaptureLinkList> {
  return apiClient.get<CaptureLinkList>(
    `/projects/${projectId}/capture-links`,
    CaptureLinkListSchema,
    accessToken,
  );
}

export async function revokeCaptureLink(
  accessToken: string,
  projectId: string,
  linkId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/capture-links/${linkId}`, accessToken);
}
