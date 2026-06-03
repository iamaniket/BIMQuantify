'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateBlogPost } from '@/lib/api/blog';
import type { BlogPostRead, BlogPostUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminBlogKey } from './queryKeys';

export function useUpdateBlogPost(): UseMutationResult<
  BlogPostRead,
  Error,
  { id: string; input: BlogPostUpdateInput }
> {
  return useAuthMutation({
    mutationFn: (accessToken, args) =>
      updateBlogPost(accessToken, args.id, args.input),
    invalidateKeys: [adminBlogKey],
  });
}
