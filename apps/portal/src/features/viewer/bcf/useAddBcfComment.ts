'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { addBcfComment } from '@/lib/api/bcf';
import type { BcfCommentCreateInput, BcfCommentRead } from '@/lib/api/schemas/bcf';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

type AddCommentVars = {
  topicId: string;
  input: BcfCommentCreateInput;
};

export function useAddBcfComment(
  projectId: string,
): UseMutationResult<BcfCommentRead, Error, AddCommentVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { topicId, input }) =>
      addBcfComment(accessToken, projectId, topicId, input),
    invalidateKeys: (vars) => [bcfKeys.detail(projectId, vars.topicId)],
  });
}
