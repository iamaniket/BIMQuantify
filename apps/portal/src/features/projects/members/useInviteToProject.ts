'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { inviteToProject } from '@/lib/api/projectMembers';
import type { ProjectInvitationInput, ProjectInvitationResponse } from '@/lib/api/projectMembers';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { projectMembersKey } from '../queryKeys';

export type InviteToProjectArgs = {
  projectId: string;
  input: ProjectInvitationInput;
};

export function useInviteToProject(): UseMutationResult<
  ProjectInvitationResponse,
  Error,
  InviteToProjectArgs
> {
  return useAuthMutation({
    mutationFn: (accessToken, { projectId, input }) =>
      inviteToProject(accessToken, projectId, input),
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
