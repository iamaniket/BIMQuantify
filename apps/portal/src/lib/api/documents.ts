import { computeFileSha256 } from '../upload/sha256';
import { apiClient } from './client';
import {
  CaptureLinkListSchema,
  CreateCaptureLinkResponseSchema,
  DocumentDownloadResponseSchema,
  DocumentInitiateResponseSchema,
  DocumentListSchema,
  DocumentSchema,
  type CaptureLink,
  type CaptureLinkList,
  type CreateCaptureLinkResponse,
  type Document,
  type DocumentCategoryValue,
  type DocumentDownloadResponse,
  type DocumentInitiateResponse,
  type DocumentList,
} from './schemas';

export type DocumentUploadProgressEvent =
  | { phase: 'hashing'; fraction: number }
  | { phase: 'uploading' }
  | { phase: 'completing' };

// ---------------------------------------------------------------------------
// Documents (authenticated)
// ---------------------------------------------------------------------------

export async function initiateDocumentUpload(
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
  },
): Promise<DocumentInitiateResponse> {
  return apiClient.post<DocumentInitiateResponse>(
    `/projects/${projectId}/documents/initiate`,
    input,
    DocumentInitiateResponseSchema,
    accessToken,
  );
}

export async function completeDocumentUpload(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<Document> {
  return apiClient.post<Document>(
    `/projects/${projectId}/documents/${documentId}/complete`,
    {},
    DocumentSchema,
    accessToken,
  );
}

export async function listDocuments(
  accessToken: string,
  projectId: string,
  category?: DocumentCategoryValue,
  linkedElementGlobalId?: string,
): Promise<DocumentList> {
  const params = new URLSearchParams();
  if (category !== undefined) params.set('category', category);
  if (linkedElementGlobalId !== undefined) params.set('linked_element_global_id', linkedElementGlobalId);
  const query = params.size === 0 ? '' : `?${params.toString()}`;
  return apiClient.get<DocumentList>(
    `/projects/${projectId}/documents${query}`,
    DocumentListSchema,
    accessToken,
  );
}

export async function getDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<Document> {
  return apiClient.get<Document>(
    `/projects/${projectId}/documents/${documentId}`,
    DocumentSchema,
    accessToken,
  );
}

export async function getDocumentDownloadUrl(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<DocumentDownloadResponse> {
  return apiClient.get<DocumentDownloadResponse>(
    `/projects/${projectId}/documents/${documentId}/download`,
    DocumentDownloadResponseSchema,
    accessToken,
  );
}

export async function updateDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
  input: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
  },
): Promise<Document> {
  return apiClient.patch<Document>(
    `/projects/${projectId}/documents/${documentId}`,
    input,
    DocumentSchema,
    accessToken,
  );
}

export async function deleteDocument(
  accessToken: string,
  projectId: string,
  documentId: string,
): Promise<void> {
  return apiClient.delete(`/projects/${projectId}/documents/${documentId}`, accessToken);
}

export async function uploadDocumentEnd2End(
  accessToken: string,
  projectId: string,
  file: File,
  extra?: {
    description?: string | null;
    linked_element_global_id?: string | null;
    linked_model_id?: string | null;
    linked_point?: Record<string, unknown> | null;
    linked_file_id?: string | null;
  },
  onProgress?: (event: DocumentUploadProgressEvent) => void,
): Promise<Document> {
  onProgress?.({ phase: 'hashing', fraction: 0 });
  const contentSha256 = await computeFileSha256(file, (fraction) => {
    onProgress?.({ phase: 'hashing', fraction });
  });

  onProgress?.({ phase: 'uploading' });
  const initResponse = await initiateDocumentUpload(accessToken, projectId, {
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
  return completeDocumentUpload(accessToken, projectId, initResponse.document_id);
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
