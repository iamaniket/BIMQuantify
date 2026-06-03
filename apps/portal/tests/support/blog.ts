import { resolve } from 'path';

import { E2E_ENV } from './env';
import { getCachedAccessToken } from './auth';

export const BLOG_FIXTURES_DIR = resolve(__dirname, '../../../../assets/blog');
export const BLOG_COVER_PATH = resolve(BLOG_FIXTURES_DIR, 'wkb-filing-workflow.jpg');
export const BLOG_MDX_EN_PATH = resolve(BLOG_FIXTURES_DIR, 'wkb-filing-workflow.mdx');
export const BLOG_MDX_NL_PATH = resolve(BLOG_FIXTURES_DIR, 'wkb-filing-workflow.nl.mdx');

export type AdminBlogPost = {
  id: string;
  slug: string;
  locale: string;
  title: string;
  description: string;
  author: string;
  tags: string[];
  published_at: string;
  status: string;
};

export type PublicBlogPost = {
  slug: string;
  locale: string;
  title: string;
  description: string;
  author: string;
  tags: string[];
  published_at: string;
};

function requireToken(email: string): string {
  const token = getCachedAccessToken(email);
  if (token === undefined) {
    throw new Error(
      `blog helpers: no cached access_token for ${email} — call loginViaUI/loginViaAPI first`,
    );
  }
  return token;
}

/**
 * List admin blog posts matching the given slug across locales. Uses the
 * admin endpoint (which sees draft + published rows) so cleanup catches
 * orphaned rows from earlier runs even when they're not visible publicly.
 */
export async function listAdminPostsBySlug(
  email: string,
  slug: string,
): Promise<AdminBlogPost[]> {
  const token = requireToken(email);
  const url = `${E2E_ENV.API_URL}/admin/blog/posts?q=${encodeURIComponent(slug)}&limit=50`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`listAdminPostsBySlug: GET returned ${resp.status}`);
  }
  const rows = (await resp.json()) as AdminBlogPost[];
  return rows.filter((row) => row.slug === slug);
}

/**
 * Delete every admin blog row matching the given slug. Idempotent — called
 * from beforeAll so reruns on a non-ephemeral DB still start clean. Silent
 * on 404 (already gone).
 */
export async function deletePostBySlugIfExists(
  email: string,
  slug: string,
): Promise<number> {
  const token = requireToken(email);
  const rows = await listAdminPostsBySlug(email, slug);
  let deleted = 0;
  for (const row of rows) {
    const resp = await fetch(
      `${E2E_ENV.API_URL}/admin/blog/posts/${row.id}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (resp.ok || resp.status === 404) {
      deleted += 1;
    } else {
      throw new Error(
        `deletePostBySlugIfExists: DELETE ${row.id} returned ${resp.status}`,
      );
    }
  }
  return deleted;
}

/**
 * Fetch a single post from the PUBLIC marketing endpoint (only sees
 * published, non-deleted rows). Returns undefined if not present —
 * useful for asserting that a draft is hidden.
 */
export async function getPublicPostBySlug(
  locale: 'en' | 'nl',
  slug: string,
): Promise<PublicBlogPost | undefined> {
  const url =
    `${E2E_ENV.API_URL}/public/blog/posts/${encodeURIComponent(slug)}`
    + `?locale=${locale}`;
  const resp = await fetch(url);
  if (resp.status === 404) return undefined;
  if (!resp.ok) {
    throw new Error(`getPublicPostBySlug: returned ${resp.status}`);
  }
  return (await resp.json()) as PublicBlogPost;
}

/**
 * Fetch the full public list for a locale. Used to assert
 * presence/absence in a single call.
 */
export async function listPublicPosts(
  locale: 'en' | 'nl',
): Promise<PublicBlogPost[]> {
  const resp = await fetch(
    `${E2E_ENV.API_URL}/public/blog/posts?locale=${locale}`,
  );
  if (!resp.ok) {
    throw new Error(`listPublicPosts: returned ${resp.status}`);
  }
  return (await resp.json()) as PublicBlogPost[];
}
