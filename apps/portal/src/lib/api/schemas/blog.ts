import { z } from 'zod';

export const BLOG_LOCALES = ['en', 'nl'] as const;
export const BLOG_STATUSES = ['draft', 'published'] as const;

export const BlogPostReadSchema = z.object({
  id: z.string(),
  slug: z.string(),
  locale: z.string(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  tags: z.array(z.string()),
  published_at: z.string(),
  cover_image_url: z.string(),
  cover_image_key: z.string(),
  content_key: z.string(),
  content: z.union([z.string(), z.null()]).optional(),
  status: z.string(),
  created_by_user_id: z.union([z.string(), z.null()]),
  created_at: z.string(),
  updated_at: z.string(),
});

export type BlogPostRead = z.infer<typeof BlogPostReadSchema>;

export const BlogPostListSchema = z.array(BlogPostReadSchema);

export const BlogPostUpdateInputSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().min(1).max(2000).optional(),
  slug: z.string().min(1).max(160).optional(),
  locale: z.enum(BLOG_LOCALES).optional(),
  author: z.string().max(120).optional(),
  tags: z.array(z.string()).optional(),
  published_at: z.string().optional(),
  status: z.enum(BLOG_STATUSES).optional(),
  content: z.string().optional(),
});

export type BlogPostUpdateInput = z.infer<typeof BlogPostUpdateInputSchema>;

// Body for `POST /admin/blog/posts` — multipart payload composed in
// `lib/api/blog.ts`. The image and content live alongside structured
// metadata; the route packs them into a `FormData` before sending.
export type BlogPostCreateInput = {
  slug: string;
  locale: 'en' | 'nl';
  title: string;
  description: string;
  author?: string;
  tags: string[];
  // ISO-8601 with timezone — typically `new Date().toISOString()`. The API
  // rejects naive timestamps with `BLOG_PUBLISHED_AT_INVALID`.
  published_at: string;
  content: string;
  status: 'draft' | 'published';
  cover: File;
};

// `POST /admin/blog/posts/bilingual` returns one row per locale.
export const BlogPostBilingualResponseSchema = z.object({
  en: BlogPostReadSchema,
  nl: BlogPostReadSchema,
});

export type BlogPostBilingualResponse = z.infer<
  typeof BlogPostBilingualResponseSchema
>;

// Body for `POST /admin/blog/posts/bilingual`. The shared fields (including
// a single cover image + single description) are sent once; the EN and NL
// halves carry only their own title + content. Backend stores the same
// cover_image_key + description on both rows.
export type BlogPostBilingualCreateInput = {
  slug: string;
  author?: string;
  tags: string[];
  published_at: string;
  status: 'draft' | 'published';
  description: string;
  cover: File;
  en: {
    title: string;
    content: string;
  };
  nl: {
    title: string;
    content: string;
  };
};
