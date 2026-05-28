import type { ZodType } from 'zod';

import { env } from '@/lib/env';

import { ApiError } from './client';
import {
  CaptureCompleteResponseSchema,
  CaptureTokenValidationSchema,
  CaptureUploadResponseSchema,
  type CaptureCompleteResponse,
  type CaptureTokenValidation,
  type CaptureUploadResponse,
} from './schemas';

async function publicGet<T>(
  path: string,
  schema: ZodType<T>,
): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}));
    const detail = typeof raw === 'object' && raw !== null && 'detail' in raw
      ? String((raw as Record<string, unknown>)['detail'])
      : response.statusText;
    throw new ApiError(response.status, detail);
  }
  const raw: unknown = await response.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function publicPost<T>(
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const raw: unknown = await response.json().catch(() => ({}));
    const detail = typeof raw === 'object' && raw !== null && 'detail' in raw
      ? String((raw as Record<string, unknown>)['detail'])
      : response.statusText;
    throw new ApiError(response.status, detail);
  }
  const raw: unknown = await response.json();
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}

export async function validateCaptureToken(
  orgId: string,
  token: string,
): Promise<CaptureTokenValidation> {
  return publicGet<CaptureTokenValidation>(
    `/public/capture/${orgId}/${token}/validate`,
    CaptureTokenValidationSchema,
  );
}

export async function initiateCaptureUpload(
  orgId: string,
  token: string,
  input: {
    filename: string;
    size_bytes: number;
    content_type: string;
    content_sha256: string;
    capture_metadata?: Record<string, unknown> | null;
  },
): Promise<CaptureUploadResponse> {
  return publicPost<CaptureUploadResponse>(
    `/public/capture/${orgId}/${token}/initiate`,
    input,
    CaptureUploadResponseSchema,
  );
}

export async function completeCaptureUpload(
  orgId: string,
  token: string,
  documentId: string,
): Promise<CaptureCompleteResponse> {
  return publicPost<CaptureCompleteResponse>(
    `/public/capture/${orgId}/${token}/complete/${documentId}`,
    {},
    CaptureCompleteResponseSchema,
  );
}

export async function uploadViaCaptureLink(
  orgId: string,
  token: string,
  file: File,
  contentSha256: string,
  captureMetadata?: Record<string, unknown> | null,
): Promise<CaptureCompleteResponse> {
  const initInput: {
    filename: string;
    size_bytes: number;
    content_type: string;
    content_sha256: string;
    capture_metadata?: Record<string, unknown> | null;
  } = {
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type === '' ? 'image/jpeg' : file.type,
    content_sha256: contentSha256,
  };
  if (captureMetadata !== undefined) {
    initInput.capture_metadata = captureMetadata;
  }
  const initResponse = await initiateCaptureUpload(orgId, token, initInput);

  const putResponse = await fetch(initResponse.upload_url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type === '' ? 'image/jpeg' : file.type },
  });
  if (!putResponse.ok) {
    throw new ApiError(putResponse.status, `Upload to storage failed: ${putResponse.statusText}`);
  }

  return completeCaptureUpload(orgId, token, initResponse.attachment_id);
}
