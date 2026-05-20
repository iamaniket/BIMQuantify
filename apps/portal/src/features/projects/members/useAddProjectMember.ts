'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { addProjectMember } from '@/lib/api/projectMembers';
import type { ProjectMember, ProjectMemberCreateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

export type AddProjectMemberArgs = {
  projectId: string;
  input: ProjectMemberCreateInput;
};

export function useAddProjectMember(): UseMutationResult<
  ProjectMember,
  Error,
  AddProjectMemberArgs
> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      addProjectMember(accessToken, projectId, input),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
