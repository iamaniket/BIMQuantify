import fs from 'node:fs';
import path from 'node:path';

import matter from 'gray-matter';
import readingTime from 'reading-time';

import type { PostMeta } from './types.js';

const CONTENT_DIR = path.join(process.cwd(), 'content', 'blog');

export function getAllSlugs(): string[] {
  if (!fs.existsSync(CONTENT_DIR)) return [];
  return fs
    .readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith('.mdx') && !f.endsWith('.nl.mdx'))
    .map((f) => f.replace(/\.mdx$/, ''));
}

export function getPostBySlug(slug: string): { meta: PostMeta; content: string } {
  const filePath = path.join(CONTENT_DIR, `${slug}.mdx`);
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
    },
    content,
  };
}

export function getAllPosts(): PostMeta[] {
  return getAllSlugs()
    .map((slug) => getPostBySlug(slug).meta)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
