'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { removeMember } from '@/lib/api/members';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from '../organizations/queryKeys';
import { orgMembersKey } from './queryKeys';

type Variables = { organizationId: string; userId: string };

export function useRemoveMember(): UseMutationResult<void, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { organizationId, userId }) => removeMember(accessToken, organizationId, userId),
    invalidateKeys: ({ organizationId }) => [
      orgMembersKey(organizationId),
      adminOrganizationKey(organizationId),
      adminOrganizationsKey,
    ],
  });
}
