import { env } from './env';

/**
 * Lightweight fetch wrapper for the marketing site. The web app has no
 * authenticated calls — registration (request-access) and legal pages now live
 * in the portal, so the only public surface left here is the blog.
 *
 * We deliberately don't pull in a heavier client (no Zod, no React Query) here:
 * the marketing build should stay small.
 */

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
  // Standalone "placeholder" mode: never reach for the backend.
  if (env.NEXT_PUBLIC_STANDALONE) return [];
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
  // Standalone "placeholder" mode: never reach for the backend.
  if (env.NEXT_PUBLIC_STANDALONE) return null;
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
