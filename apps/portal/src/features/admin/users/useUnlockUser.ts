'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { unlockUser } from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminUsersKey } from './queryKeys';

type Variables = { userId: string };

/** H6: clear an account's failed-login lockout (super-admin only). */
export function useUnlockUser(): UseMutationResult<AdminUserRead, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId }) => unlockUser(accessToken, userId),
    invalidateKeys: [adminUsersKey],
  });
}
