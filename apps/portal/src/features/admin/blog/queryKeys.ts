import type { ListBlogPostsParams } from '@/lib/api/blog';

export const adminBlogKey = ['admin', 'blog'] as const;

export const adminBlogListKey = (
  params: ListBlogPostsParams,
): readonly ['admin', 'blog', 'list', ListBlogPostsParams] =>
  ['admin', 'blog', 'list', params] as const;
