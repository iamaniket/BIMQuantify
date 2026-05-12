import { env } from './env';

/**
 * Lightweight fetch wrapper for the marketing site. Unlike the portal,
 * the web app has no authenticated calls — every request is anonymous and
 * to one of the `/public/*` or `/access-requests` endpoints.
 *
 * We deliberately don't pull in a heavier client (no Zod, no React Query)
 * here: the surface is two endpoints and the marketing build should stay
 * small.
 */
export class WebApiError extends Error {
  public readonly status: number;
  public readonly detail: string;
  public constructor(status: number, detail: string) {
    super(`API ${String(status)}: ${detail}`);
    this.status = status;
    this.detail = detail;
  }
}

export interface AccessRequestPayload {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  country: string;
  notes?: string | undefined;
  terms_accepted: boolean;
}

export interface AccessRequestResponse {
  id: string;
  name: string;
  work_email: string;
  company: string;
  status: string;
  created_at: string;
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail.find(
        (entry): entry is { msg: string } =>
          typeof entry === 'object' && entry !== null && typeof (entry as { msg?: unknown }).msg === 'string',
      );
      if (first) return first.msg;
    }
    if (body.detail !== undefined) return JSON.stringify(body.detail);
  } catch {
    /* fall through */
  }
  return response.statusText || 'Request failed';
}

export async function submitAccessRequest(
  payload: AccessRequestPayload,
): Promise<AccessRequestResponse> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/access-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new WebApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as AccessRequestResponse;
}

export interface PublicProjectsMapPoint {
  city: string;
  lat: number;
  lng: number;
  count: number;
}

export async function fetchProjectsMap(): Promise<PublicProjectsMapPoint[]> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/public/projects-map`);
  if (!response.ok) {
    throw new WebApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as PublicProjectsMapPoint[];
}
