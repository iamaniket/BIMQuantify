import fs from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';
import readingTime from 'reading-time';

import type { Locale } from '@bimstitch/i18n';

import type { PostMeta } from './types.js';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog');

function fileNameForSlug(slug: string, locale: Locale): string {
  return locale === 'nl' ? `${slug}.nl.mdx` : `${slug}.mdx`;
}

function resolvePostPath(slug: string, locale: Locale): string {
  const preferred = path.join(CONTENT_DIR, fileNameForSlug(slug, locale));
  if (fs.existsSync(preferred)) return preferred;
  // Fallback: NL posts fall back to the English copy when no translation exists.
  const fallback = path.join(CONTENT_DIR, `${slug}.mdx`);
  return fallback;
}

export function getAllSlugs(_locale: Locale): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  // Every post has at least an English `slug.mdx`; NL falls back to it when no
  // `slug.nl.mdx` translation exists. So the slug set is the same for both
  // locales — derive it from the English files only.
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.mdx') && !f.endsWith('.nl.mdx'))
    .map((f) => f.replace(/\.mdx$/, ''));
}

export function getPostBySlug(slug: string, locale: Locale): { meta: PostMeta; content: string } {
  const filePath = resolvePostPath(slug, locale);
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  const stats = readingTime(content);

  return {
    meta: {
      title: String(data['title'] ?? ''),
      description: String(data['description'] ?? ''),
      date: String(data['date'] ?? ''),
      tags: Array.isArray(data['tags']) ? (data['tags'] as string[]) : [],
      author: String(data['author'] ?? 'BimDossier'),
      slug,
      readingTime: stats.text,
      image: typeof data['image'] === 'string' ? data['image'] : undefined,
    },
    content,
  };
}

export function getAllPosts(locale: Locale): PostMeta[] {
  return getAllSlugs(locale)
    .map((slug) => getPostBySlug(slug, locale).meta)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
