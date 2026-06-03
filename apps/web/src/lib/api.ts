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

export type AccessRequestPayload = {
  name: string;
  work_email: string;
  company: string;
  role: string;
  company_size: string;
  country: string;
  notes: string | undefined;
  terms_accepted: boolean;
};

export type AccessRequestResponse = {
  id: string;
  name: string;
  work_email: string;
  company: string;
  status: string;
  created_at: string;
};

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) {
      const first = body.detail.find((entry): entry is { msg: string } => typeof entry === 'object'
        && entry !== null
        && typeof (entry as { msg: unknown }).msg === 'string');
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

export type PublicSystemStatus = {
  status: 'normal' | 'degraded' | 'down';
  region: string;
  node: string;
  wkb_version: string;
  bbl_version: string;
  ifc_version: string;
};

export async function fetchSystemStatus(): Promise<PublicSystemStatus> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/public/system-status`);
  if (!response.ok) {
    throw new WebApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as PublicSystemStatus;
}

export type PublicProjectsMapPoint = {
  city: string;
  lat: number;
  lng: number;
  count: number;
};

export async function fetchProjectsMap(): Promise<PublicProjectsMapPoint[]> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/public/projects-map`);
  if (!response.ok) {
    throw new WebApiError(response.status, await readErrorDetail(response));
  }
  return (await response.json()) as PublicProjectsMapPoint[];
}

// ---------------------------------------------------------------------------
// Blog (public — drives the /blog listing + detail pages alongside in-repo
// MDX files). The API surfaces only published, non-deleted posts.
// ---------------------------------------------------------------------------

export type PublicBlogPost = {
  slug: string;
  locale: string;
  title: string;
  description: string;
  author: string;
  tags: string[];
  published_at: string;
  cover_image_url: string;
  content: string | null;
  reading_time_minutes: number;
};

/**
 * List published blog posts for a locale. Returns `[]` on any network/API
 * failure — the listing page degrades to in-repo posts only. This is the
 * defensive choice for a marketing surface: an API blip must never make the
 * blog appear empty.
 */
export async function fetchBlogPosts(locale: string): Promise<PublicBlogPost[]> {
  try {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/public/blog/posts?locale=${encodeURIComponent(locale)}`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return [];
    return (await response.json()) as PublicBlogPost[];
  } catch {
    return [];
  }
}

/** Fetch a single published blog post by slug. Returns null when missing —
 * the detail page falls back to the in-repo MDX reader for unknown slugs. */
export async function fetchBlogPost(
  slug: string,
  locale: string,
): Promise<PublicBlogPost | null> {
  try {
    const response = await fetch(
      `${env.NEXT_PUBLIC_API_URL}/public/blog/posts/${encodeURIComponent(slug)}?locale=${encodeURIComponent(locale)}`,
      { next: { revalidate: 60 } },
    );
    if (!response.ok) return null;
    return (await response.json()) as PublicBlogPost;
  } catch {
    return null;
  }
}
