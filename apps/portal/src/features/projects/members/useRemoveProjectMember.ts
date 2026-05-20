'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { removeProjectMember } from '@/lib/api/projectMembers';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

export type RemoveProjectMemberArgs = {
  projectId: string;
  userId: string;
};

export function useRemoveProjectMember(): UseMutationResult<
  void,
  Error,
  RemoveProjectMemberArgs
> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, userId }) =>
      removeProjectMember(accessToken, projectId, userId),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
