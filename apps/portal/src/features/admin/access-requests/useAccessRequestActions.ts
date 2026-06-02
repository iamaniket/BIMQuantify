'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  approveAccessRequest,
  rejectAccessRequest,
} from '@/lib/api/admin';
import type { AccessRequestRead } from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminAccessRequestsKey } from './queryKeys';

export function useApproveAccessRequest(): UseMutationResult<
  AccessRequestRead,
  Error,
  { id: string }
> {
  return useAuthMutation({
    mutationFn: (accessToken, { id }) =>
      approveAccessRequest(accessToken, id),
    invalidateKeys: [adminAccessRequestsKey],
  });
}

export function useRejectAccessRequest(): UseMutationResult<
  AccessRequestRead,
  Error,
  { id: string }
> {
  return useAuthMutation({
    mutationFn: (accessToken, { id }) =>
      rejectAccessRequest(accessToken, id),
    invalidateKeys: [adminAccessRequestsKey],
  });
}
