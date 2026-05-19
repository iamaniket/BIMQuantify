'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { inviteMember } from '@/lib/api/members';
import type { MemberInviteInput, MemberRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from '../organizations/queryKeys';
import { orgMembersKey } from './queryKeys';

type Variables = { organizationId: string; input: MemberInviteInput };

export function useInviteMember(): UseMutationResult<MemberRead, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { organizationId, input }) => inviteMember(accessToken, organizationId, input),
    // Adding a member changes seat_count_used → also invalidate the org row.
    invalidateKeys: ({ organizationId }) => [
      orgMembersKey(organizationId),
      adminOrganizationKey(organizationId),
      adminOrganizationsKey,
    ],
  });
}
