'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
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
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, userId }) =>
      removeProjectMember(accessToken, projectId, userId, isPooled),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
