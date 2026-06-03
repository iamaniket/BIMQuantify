import { z } from 'zod';

/**
 * RHF schema for the 3-step blog-post wizard.
 *
 * Shared metadata (description, date, status, author, tags) lives in step 1
 * alongside the cover image (cover image is *not* a form field — it's parent
 * state, mirrors how ProjectFormDialog manages `thumbnailFile`). Slug is
 * derived from the EN title at submit time via `slugify()`, so it's not
 * carried on the form either.
 */
export const BlogFormSchema = z.object({
  // Shared metadata.
  description: z.string().min(1, { message: 'required' }).max(2000),
  // YYYY-MM-DD from <input type="date">.
  date: z
    .string()
    .min(1, { message: 'required' })
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date' }),
  status: z.enum(['draft', 'published']),
  author: z.string().max(120).optional().or(z.literal('')),
  // Comma-separated; we split + dedupe at submit time.
  tags: z.string().max(500).optional().or(z.literal('')),

  // EN half.
  title_en: z.string().min(1, { message: 'required' }).max(255),
  content_en: z.string().min(1, { message: 'required' }).max(200_000),

  // NL half.
  title_nl: z.string().min(1, { message: 'required' }).max(255),
  content_nl: z.string().min(1, { message: 'required' }).max(200_000),
});

export type BlogFormValues = z.infer<typeof BlogFormSchema>;
