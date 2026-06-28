'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { unlockUser } from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminOrganizationKey, adminOrganizationsKey } from '../organizations/queryKeys';
import { orgMembersKey } from './queryKeys';

type Variables = { organizationId: string; userId: string };

/** H6: clear a member's failed-login lockout (super-admin only). Reuses the
 *  platform `unlockUser` endpoint by user id, then refreshes the member list. */
export function useUnlockMember(): UseMutationResult<AdminUserRead, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId }) => unlockUser(accessToken, userId),
    invalidateKeys: ({ organizationId }) => [
      orgMembersKey(organizationId),
      adminOrganizationKey(organizationId),
      adminOrganizationsKey,
    ],
  });
}
