'use client';

import type { UseMutationResult } from '@tanstack/react-query';

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
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, userId, input }) =>
      updateProjectMemberRole(accessToken, projectId, userId, input),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
