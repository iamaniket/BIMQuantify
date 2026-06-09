'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateBcfTopic } from '@/lib/api/bcf';
import type { BcfTopicRead, BcfTopicUpdateInput } from '@/lib/api/schemas/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

type UpdateVars = {
  topicId: string;
  input: BcfTopicUpdateInput;
};

export function useUpdateBcfTopic(
  projectId: string,
): UseMutationResult<BcfTopicRead, Error, UpdateVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { topicId, input }) =>
      updateBcfTopic(accessToken, projectId, topicId, input),
    invalidateKeys: (vars) => [
      bcfKeys.list(projectId),
      bcfKeys.detail(projectId, vars.topicId),
    ],
  });
}
