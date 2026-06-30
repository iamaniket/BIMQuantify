import { apiClient, type PaginatedResponse } from './client';
import { env } from '@/lib/env';
import {
  BlogPostBilingualResponseSchema,
  BlogPostListSchema,
  BlogPostReadSchema,
  type BlogPostBilingualCreateInput,
  type BlogPostBilingualResponse,
  type BlogPostCreateInput,
  type BlogPostRead,
  type BlogPostUpdateInput,
} from './schemas/blog';

export type ListBlogPostsParams = {
  locale?: 'en' | 'nl' | undefined;
  status?: 'draft' | 'published' | undefined;
  q?: string | undefined;
  include_deleted?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
  order_by?: string | undefined;
  order_dir?: 'asc' | 'desc' | undefined;
};

function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const parts: string[] = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  });
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listBlogPostsPage(
  accessToken: string,
  params: ListBlogPostsParams = {},
): Promise<PaginatedResponse<BlogPostRead[]>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<BlogPostRead[]>(
    `/admin/blog/posts${query}`,
    BlogPostListSchema,
    accessToken,
  );
}

export async function getBlogPost(
  accessToken: string,
  id: string,
): Promise<BlogPostRead> {
  return apiClient.get<BlogPostRead>(
    `/admin/blog/posts/${id}`,
    BlogPostReadSchema,
    accessToken,
  );
}

// Multipart body. The plain `apiClient.post` wraps `JSON.stringify` so we
// can't reuse it — but we still go through the same response-validation
// pipeline by hand-parsing with the Zod schema after the fetch.
async function _multipartUpload<TSchema extends { parse: (value: unknown) => unknown }>(
  path: string,
  method: 'POST' | 'PUT',
  accessToken: string,
  body: FormData,
  schema: TSchema,
): Promise<ReturnType<TSchema['parse']>> {
  const response = await fetch(`${env.NEXT_PUBLIC_API_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    body,
  });
  if (!response.ok) {
    // Surface the structured detail string so the portal's error-message
    // catalog can map it back to a localized message.
    let detail = response.statusText;
    try {
      const errBody: unknown = await response.json();
      if (
        errBody &&
        typeof errBody === 'object' &&
        'detail' in errBody &&
        typeof (errBody).detail === 'string'
      ) {
        detail = (errBody as { detail: string }).detail;
      }
    } catch {
      // ignore — fall through with statusText
    }
    const err = new Error(detail) as Error & {
      status?: number;
      code?: string;
    };
    err.status = response.status;
    err.code = detail;
    throw err;
  }
  const raw: unknown = await response.json();
  return schema.parse(raw) as ReturnType<TSchema['parse']>;
}

export async function createBlogPost(
  accessToken: string,
  input: BlogPostCreateInput,
): Promise<BlogPostRead> {
  const formData = new FormData();
  formData.append('slug', input.slug);
  formData.append('locale', input.locale);
  formData.append('title', input.title);
  formData.append('description', input.description);
  formData.append('content', input.content);
  formData.append('published_at', input.published_at);
  formData.append('author', input.author ?? 'BimDossier');
  formData.append('tags', JSON.stringify(input.tags));
  formData.append('status', input.status);
  formData.append('cover', input.cover);
  return _multipartUpload(
    '/admin/blog/posts',
    'POST',
    accessToken,
    formData,
    BlogPostReadSchema,
  );
}

export async function createBilingualBlogPost(
  accessToken: string,
  input: BlogPostBilingualCreateInput,
): Promise<BlogPostBilingualResponse> {
  const formData = new FormData();
  // Shared fields — collapsed bilingual endpoint takes a single cover image
  // and a single description; both EN and NL rows persist the same string
  // values on their respective columns.
  formData.append('slug', input.slug);
  formData.append('author', input.author ?? 'BimDossier');
  formData.append('tags', JSON.stringify(input.tags));
  formData.append('published_at', input.published_at);
  formData.append('status', input.status);
  formData.append('description', input.description);
  formData.append('cover', input.cover);
  // Per-locale title + content.
  formData.append('title_en', input.en.title);
  formData.append('content_en', input.en.content);
  formData.append('title_nl', input.nl.title);
  formData.append('content_nl', input.nl.content);
  return _multipartUpload(
    '/admin/blog/posts/bilingual',
    'POST',
    accessToken,
    formData,
    BlogPostBilingualResponseSchema,
  );
}

export async function updateBlogPost(
  accessToken: string,
  id: string,
  input: BlogPostUpdateInput,
): Promise<BlogPostRead> {
  return apiClient.patch<BlogPostRead>(
    `/admin/blog/posts/${id}`,
    input,
    BlogPostReadSchema,
    accessToken,
  );
}

export async function replaceBlogCover(
  accessToken: string,
  id: string,
  file: File,
): Promise<BlogPostRead> {
  const formData = new FormData();
  formData.append('cover', file);
  return _multipartUpload(
    `/admin/blog/posts/${id}/cover`,
    'PUT',
    accessToken,
    formData,
    BlogPostReadSchema,
  );
}

export async function deleteBlogPost(
  accessToken: string,
  id: string,
): Promise<void> {
  return apiClient.delete(`/admin/blog/posts/${id}`, accessToken);
}
