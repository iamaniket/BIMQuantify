import { z } from 'zod';

import { ApiError } from '@/lib/api/client';
import { env } from '@/lib/env';

const AccessRequestResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  work_email: z.string(),
  company: z.string(),
  role: z.string(),
  company_size: z.string(),
  country: z.string(),
  notes: z.string().nullable(),
  status: z.string(),
  created_at: z.string(),
});

export type AccessRequestResponse = z.infer<typeof AccessRequestResponseSchema>;

export type AccessRequestPayload = {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  country: string;
  notes?: string | undefined;
  terms_accepted: boolean;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail.find(
        (entry): entry is { msg: string } =>
          typeof entry === 'object'
          && entry !== null
          && typeof (entry as { msg?: unknown }).msg === 'string',
      );
      if (first) return first.msg;
    }
    if (body.detail !== undefined) return JSON.stringify(body.detail);
  } catch {
    /* fall through */
  }
  return response.statusText || 'Request failed';
}

/**
 * Submits a lead-capture request to `POST /access-requests`. The endpoint is
 * public — no auth token. The shared `apiClient.post` requires an access
 * token by signature, so this helper goes through `fetch` directly while
 * reusing the same `ApiError` type so callers can branch on `status`.
 */
export async function submitAccessRequest(
  payload: AccessRequestPayload,
): Promise<AccessRequestResponse> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/access-requests`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await readErrorDetail(response));
  }
  const raw = (await response.json()) as unknown;
  const parsed = AccessRequestResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(500, `Response validation failed: ${parsed.error.message}`);
  }
  return parsed.data;
}
