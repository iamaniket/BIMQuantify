'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeContext } from '@/hooks/useIsFreeUser';
import { updateProjectMemberRole } from '@/lib/api/projectMembers';
import type { ProjectMember, ProjectMemberUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

export type UpdateProjectMemberRoleArgs = {
  projectId: string;
  userId: string;
  input: ProjectMemberUpdateInput;
};

export function useUpdateProjectMemberRole(): UseMutationResult<
  ProjectMember,
  Error,
  UpdateProjectMemberRoleArgs
> {
  const { isFreeUser } = useIsFreeContext();
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, userId, input }) =>
      updateProjectMemberRole(accessToken, projectId, userId, input, isFreeUser),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
