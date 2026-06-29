import * as FileSystem from 'expo-file-system/legacy';

import { completeAttachment, initiateAttachment } from '@/lib/api/attachments';
import { ApiError } from '@/lib/api/client';
import { completeFreeAttachment, initiateFreeAttachment } from '@/lib/api/freeAttachments';
import { tokenManager } from '@/lib/api/tokenManager';

import type { CapturedPhoto } from './capture';

async function uploadOnce(
  token: string,
  projectId: string,
  photo: CapturedPhoto,
  isFree: boolean,
): Promise<string> {
  // The localId doubles as the Idempotency-Key so a replayed initiate (after a
  // lost response) returns the same row with a fresh presigned URL.
  const body = {
    filename: photo.fileName,
    size_bytes: photo.sizeBytes,
    content_type: photo.contentType,
    content_sha256: photo.sha256,
    capture_metadata: {
      captured_at: photo.capturedAt,
      capture_method: photo.captureMethod,
      geolocation: photo.geolocation ?? null,
      exif: photo.exif ?? null,
    },
  };
  const init = isFree
    ? await initiateFreeAttachment(token, projectId, body, photo.localId)
    : await initiateAttachment(token, projectId, body, photo.localId);

  // Stream the file bytes straight to MinIO (no auth header — the URL is
  // presigned). uploadAsync avoids loading the whole image into JS memory.
  const res = await FileSystem.uploadAsync(init.upload_url, photo.uri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: { 'Content-Type': photo.contentType },
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Photo upload failed (HTTP ${String(res.status)})`);
  }

  const att = isFree
    ? await completeFreeAttachment(token, projectId, init.attachment_id)
    : await completeAttachment(token, projectId, init.attachment_id);
  return att.id;
}

/**
 * Upload a captured photo via the two-phase presigned flow and return the real
 * attachment id. Retries once on a 401 by refreshing the access token (the same
 * pattern as useAuthMutation; the photo path doesn't run through React Query).
 * `isFree` routes to the `/free/*` attachment endpoints for org-less users.
 */
export async function uploadPhoto(
  token: string,
  projectId: string,
  photo: CapturedPhoto,
  isFree: boolean,
): Promise<string> {
  try {
    return await uploadOnce(token, projectId, photo, isFree);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      const fresh = await tokenManager.refresh();
      return uploadOnce(fresh, projectId, photo, isFree);
    }
    throw err;
  }
}
