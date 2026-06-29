'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  activateUser,
  deactivateUser,
  deleteUser,
  resendActivation,
  sendPasswordReset,
} from '@/lib/api/admin';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminUsersKey } from '../users/queryKeys';
import { adminFreeUserDetailKey, adminFreeUsersKey } from './queryKeys';

type UserVars = { userId: string };

/**
 * Suspend/reactivate a free user. Reuses the existing activate/deactivate
 * endpoints; invalidates BOTH the free-users list and the global users list
 * (the same row shows in both surfaces) plus this user's detail.
 */
export function useToggleActivateFreeUser(): UseMutationResult<
  AdminUserRead,
  Error,
  { userId: string; active: boolean }
> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId, active }) => (active
      ? activateUser(accessToken, userId)
      : deactivateUser(accessToken, userId)),
    invalidateKeys: ({ userId }) => [
      adminFreeUsersKey,
      adminUsersKey,
      adminFreeUserDetailKey(userId),
    ],
  });
}

/** Anonymize-in-place (GDPR delete). Removes the user from the free list. */
export function useDeleteFreeUser(): UseMutationResult<void, Error, UserVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId }) => deleteUser(accessToken, userId),
    invalidateKeys: [adminFreeUsersKey, adminUsersKey],
  });
}

export function useSendPasswordReset(): UseMutationResult<void, Error, UserVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId }) => sendPasswordReset(accessToken, userId),
  });
}

export function useResendActivation(): UseMutationResult<void, Error, UserVars> {
  return useAuthMutation({
    mutationFn: (accessToken, { userId }) => resendActivation(accessToken, userId),
  });
}
