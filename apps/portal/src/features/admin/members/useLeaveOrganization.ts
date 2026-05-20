'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { leaveOrganization } from '@/lib/api/members';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from '../organizations/queryKeys';
import { orgMembersKey } from './queryKeys';

type Variables = {
  organizationId: string;
  // Required when the leaving user owns one or more projects in the org.
  reassignTo?: string;
};

export function useLeaveOrganization(): UseMutationResult<void, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { organizationId, reassignTo }) => leaveOrganization(
      accessToken,
      organizationId,
      reassignTo === undefined ? undefined : { reassign_to: reassignTo },
    ),
    invalidateKeys: ({ organizationId }) => [
      orgMembersKey(organizationId),
      adminOrganizationKey(organizationId),
      adminOrganizationsKey,
    ],
  });
}
