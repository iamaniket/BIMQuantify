'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createBilingualBlogPost } from '@/lib/api/blog';
import type {
  BlogPostBilingualCreateInput,
  BlogPostBilingualResponse,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminBlogKey } from './queryKeys';

export function useCreateBlogPost(): UseMutationResult<
  BlogPostBilingualResponse,
  Error,
  BlogPostBilingualCreateInput
> {
  return useAuthMutation({
    mutationFn: (accessToken, input) =>
      createBilingualBlogPost(accessToken, input),
    invalidateKeys: [adminBlogKey],
  });
}
