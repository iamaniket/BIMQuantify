import { z } from 'zod';

import { apiClient } from './client';
import { projectScope } from './scope';
import {
  AttachmentDownloadResponseSchema,
  AttachmentInitiateResponseSchema,
  AttachmentReadSchema,
  type AttachmentDownloadResponse,
  type AttachmentInitiateRequest,
  type AttachmentInitiateResponse,
} from './schemas/attachments';

// Two-phase presigned upload (initiate -> PUT bytes -> complete). The raw PUT
// to MinIO is done by expo-file-system in features/photos/upload.ts (it streams
// the file and needs no auth header), so the client here only owns the two
// token-gated JSON calls. `free` routes to the `/free/*` attachment endpoints.
//
// The free `complete` returns PooledAttachmentRead (`pooled_project_id`, not
// `project_id`); the upload flow only needs the id, so a minimal schema decouples
// it (paid still parses the full `AttachmentRead`). Both expose `id`.

const attachmentScope = (projectId: string, free: boolean): string =>
  `${projectScope(projectId, free)}/attachments`;

const PooledAttachmentReadSchema = z.object({ id: z.string().uuid() });

export async function initiateAttachment(
  token: string,
  projectId: string,
  body: AttachmentInitiateRequest,
  idempotencyKey?: string,
  free = false,
): Promise<AttachmentInitiateResponse> {
  return apiClient.post(
    `${attachmentScope(projectId, free)}/initiate`,
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
  free = false,
): Promise<{ id: string }> {
  // The complete endpoint takes no body; an empty object satisfies the JSON POST.
  const path = `${attachmentScope(projectId, free)}/${attachmentId}/complete`;
  if (free) return apiClient.post(path, {}, PooledAttachmentReadSchema, token);
  return apiClient.post(path, {}, AttachmentReadSchema, token);
}

export async function getAttachmentDownloadUrl(
  token: string,
  projectId: string,
  attachmentId: string,
  free = false,
): Promise<AttachmentDownloadResponse> {
  return apiClient.get(
    `${attachmentScope(projectId, free)}/${attachmentId}/download`,
    AttachmentDownloadResponseSchema,
    token,
  );
}
