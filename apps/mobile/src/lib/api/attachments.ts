import { apiClient } from './client';
import {
  AttachmentDownloadResponseSchema,
  AttachmentInitiateResponseSchema,
  AttachmentReadSchema,
  type AttachmentDownloadResponse,
  type AttachmentInitiateRequest,
  type AttachmentInitiateResponse,
  type AttachmentRead,
} from './schemas/attachments';

// Two-phase presigned upload (initiate -> PUT bytes -> complete). The raw PUT
// to MinIO is done by expo-file-system in features/photos/upload.ts (it streams
// the file and needs no auth header), so the client here only owns the two
// token-gated JSON calls.

export async function initiateAttachment(
  token: string,
  projectId: string,
  body: AttachmentInitiateRequest,
  idempotencyKey?: string,
): Promise<AttachmentInitiateResponse> {
  return apiClient.post(
    `/projects/${projectId}/attachments/initiate`,
    body,
    AttachmentInitiateResponseSchema,
    token,
    idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

export async function completeAttachment(
  token: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentRead> {
  // The complete endpoint takes no body; an empty object satisfies the JSON POST.
  return apiClient.post(
    `/projects/${projectId}/attachments/${attachmentId}/complete`,
    {},
    AttachmentReadSchema,
    token,
  );
}

export async function getAttachmentDownloadUrl(
  token: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get(
    `/projects/${projectId}/attachments/${attachmentId}/download`,
    AttachmentDownloadResponseSchema,
    token,
  );
}
