'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeContext } from '@/hooks/useIsFreeUser';
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
  const { isFreeUser } = useIsFreeContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, userId }) =>
      removeProjectMember(accessToken, projectId, userId, isFreeUser),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
