'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { deleteBcfTopic } from '@/lib/api/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

export function useDeleteBcfTopic(
  projectId: string,
): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, topicId) =>
      deleteBcfTopic(accessToken, projectId, topicId),
    invalidateKeys: [bcfKeys.list(projectId)],
  });
}
