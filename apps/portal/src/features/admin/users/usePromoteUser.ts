'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { demoteUser, promoteUser } from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminUsersKey } from './queryKeys';

type Variables = { userId: string; superuser: boolean };

export function useTogglePromoteUser(): UseMutationResult<
  AdminUserRead,
  Error,
  Variables
  > {
  return useAuthMutation({
    mutationFn: (accessToken, { userId, superuser }) => (superuser ? promoteUser(accessToken, userId) : demoteUser(accessToken, userId)),
    invalidateKeys: [adminUsersKey],
  });
}
