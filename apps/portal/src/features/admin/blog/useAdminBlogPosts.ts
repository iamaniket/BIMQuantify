'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listBlogPosts, type ListBlogPostsParams } from '@/lib/api/blog';
import type { BlogPostRead } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminBlogListKey } from './queryKeys';

export function useAdminBlogPosts(
  params: ListBlogPostsParams = {},
): UseQueryResult<BlogPostRead[]> {
  return useAuthQuery({
    queryKey: adminBlogListKey(params),
    queryFn: (accessToken) => listBlogPosts(accessToken, params),
  });
}
