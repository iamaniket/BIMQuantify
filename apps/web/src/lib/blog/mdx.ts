import fs from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';
import readingTime from 'reading-time';

import type { Locale } from '@bimstitch/i18n';

import { fetchBlogPost, fetchBlogPosts } from '../api';
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

/** ~200 wpm matches the `reading-time` package used for in-repo posts, so
 * the two sources display comparable estimates. */
function readingTimeText(minutes: number): string {
  return `${String(Math.max(1, minutes))} min read`;
}

/**
 * Merged listing: every in-repo MDX file, plus every published API post that
 * doesn't collide with one. In-repo wins on slug collisions — the committed
 * file is the authoritative source, the API copy is treated as an outdated
 * draft.
 */
export async function getAllPostsMerged(locale: Locale): Promise<PostMeta[]> {
  const local = getAllPosts(locale);
  const remote = await fetchBlogPosts(locale);
  const seen = new Set(local.map((p) => p.slug));
  const remoteMeta: PostMeta[] = remote
    .filter((r) => !seen.has(r.slug))
    .map((r) => ({
      title: r.title,
      description: r.description,
      date: r.published_at,
      tags: r.tags,
      author: r.author,
      slug: r.slug,
      readingTime: readingTimeText(r.reading_time_minutes),
      image: r.cover_image_url,
    }));
  return [...local, ...remoteMeta].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
}

/**
 * Single-post fetch with the same precedence: in-repo MDX first, API
 * fallback for slugs the filesystem doesn't know about. Returns null when
 * neither source has the slug — the caller renders 404.
 */
export async function getPostBySlugMerged(
  slug: string,
  locale: Locale,
): Promise<{ meta: PostMeta; content: string } | null> {
  // Probe filesystem first. `resolvePostPath` falls back to the EN file when
  // a NL translation doesn't exist, so we have to check actual existence to
  // tell "in-repo" from "would fall back to a remote-only post."
  const localFilePath = path.join(CONTENT_DIR, fileNameForSlug(slug, locale));
  const englishFallback = path.join(CONTENT_DIR, `${slug}.mdx`);
  if (fs.existsSync(localFilePath) || fs.existsSync(englishFallback)) {
    return getPostBySlug(slug, locale);
  }
  const remote = await fetchBlogPost(slug, locale);
  if (remote === null) return null;
  return {
    meta: {
      title: remote.title,
      description: remote.description,
      date: remote.published_at,
      tags: remote.tags,
      author: remote.author,
      slug: remote.slug,
      readingTime: readingTimeText(remote.reading_time_minutes),
      image: remote.cover_image_url,
    },
    content: remote.content ?? '',
  };
}
