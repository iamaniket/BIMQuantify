import { z } from 'zod';

import { apiClient } from '@/lib/api/client';
import {
  AttachmentDownloadResponseSchema,
  AttachmentInitiateResponseSchema,
  type AttachmentDownloadResponse,
  type AttachmentInitiateRequest,
  type AttachmentInitiateResponse,
} from '@/lib/api/schemas/attachments';

// FREE-tier attachments (photo evidence on free snags). The initiate/download
// responses are identical to paid; complete returns FreeAttachmentRead (uses
// `free_project_id`, not `project_id`), but the upload flow only needs the id —
// a minimal schema (extra keys ignored by Zod) keeps it decoupled.

const FreeAttachmentReadSchema = z.object({ id: z.string().uuid() });
type FreeAttachmentRead = z.infer<typeof FreeAttachmentReadSchema>;

export async function initiateFreeAttachment(
  token: string,
  projectId: string,
  body: AttachmentInitiateRequest,
  idempotencyKey?: string,
): Promise<AttachmentInitiateResponse> {
  return apiClient.post(
    `/free/projects/${projectId}/attachments/initiate`,
    body,
    AttachmentInitiateResponseSchema,
    token,
    idempotencyKey !== undefined ? { 'Idempotency-Key': idempotencyKey } : undefined,
  );
}

export async function completeFreeAttachment(
  token: string,
  projectId: string,
  attachmentId: string,
): Promise<FreeAttachmentRead> {
  return apiClient.post(
    `/free/projects/${projectId}/attachments/${attachmentId}/complete`,
    {},
    FreeAttachmentReadSchema,
    token,
  );
}

export async function getFreeAttachmentDownloadUrl(
  token: string,
  projectId: string,
  attachmentId: string,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get(
    `/free/projects/${projectId}/attachments/${attachmentId}/download`,
    AttachmentDownloadResponseSchema,
    token,
  );
}
