'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { updateMember } from '@/lib/api/members';
import type { MemberRead, MemberUpdateInput } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from '../organizations/queryKeys';
import { orgMembersKey } from './queryKeys';

type Variables = {
  organizationId: string;
  userId: string;
  input: MemberUpdateInput;
};

export function useUpdateMember(): UseMutationResult<MemberRead, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { organizationId, userId, input }) => updateMember(accessToken, organizationId, userId, input),
    // status changes may free or reclaim a seat → invalidate org as well.
    invalidateKeys: ({ organizationId }) => [
      orgMembersKey(organizationId),
      adminOrganizationKey(organizationId),
      adminOrganizationsKey,
    ],
  });
}
