'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { createBcfTopic } from '@/lib/api/bcf';
import type { BcfTopicCreateInput, BcfTopicRead } from '@/lib/api/schemas/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

export function useCreateBcfTopic(
  projectId: string,
): UseMutationResult<BcfTopicRead, Error, BcfTopicCreateInput> {
  return useAuthMutation({
    mutationFn: (accessToken, input) =>
      createBcfTopic(accessToken, projectId, input),
    invalidateKeys: [bcfKeys.list(projectId)],
  });
}
