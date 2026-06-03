'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteBlogPost } from '@/lib/api/blog';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminBlogKey } from './queryKeys';

export function useDeleteBlogPost(): UseMutationResult<
  void,
  Error,
  { id: string }
> {
  return useAuthMutation({
    mutationFn: (accessToken, args) => deleteBlogPost(accessToken, args.id),
    invalidateKeys: [adminBlogKey],
  });
}
