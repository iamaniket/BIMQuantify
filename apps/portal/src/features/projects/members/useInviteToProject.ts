'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { useIsFreeContext } from '@/hooks/useIsFreeUser';
import { inviteFreeProjectMember } from '@/lib/api/freeProjects';
import { inviteToProject } from '@/lib/api/projectMembers';
import type { ProjectInvitationInput, ProjectInvitationResponse } from '@/lib/api/projectMembers';
import type { ProjectRole } from '@/lib/api/schemas';
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
  // Free-aware: in the free workspace, invites go to the pooled member endpoint
  // (by email, owner-only). The free endpoint returns a ProjectMember, which we
  // adapt to the paid ProjectInvitationResponse shape so consumers are unchanged.
  const { isFreeUser } = useIsFreeContext();
  return useAuthMutation({
    mutationFn: async (accessToken, { projectId, input }) => {
      if (isFreeUser) {
        const member = await inviteFreeProjectMember(accessToken, projectId, {
          email: input.email,
          role: (input.role as ProjectRole | undefined) ?? 'viewer',
        });
        return {
          email: member.email,
          role: member.role,
          project_id: member.project_id,
          scenario: 'free_member',
          user_id: member.user_id,
        } satisfies ProjectInvitationResponse;
      }
      return inviteToProject(accessToken, projectId, input);
    },
    invalidateKeys: (variables) => [projectMembersKey(variables.projectId)],
  });
}
