'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { activateUser, deactivateUser } from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminUsersKey } from './queryKeys';

type Variables = { userId: string; active: boolean };

export function useToggleActivateUser(): UseMutationResult<
  AdminUserRead,
  Error,
  Variables
> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId, active }) => (active
      ? activateUser(accessToken, userId)
      : deactivateUser(accessToken, userId)),
    invalidateKeys: [adminUsersKey],
  });
}
