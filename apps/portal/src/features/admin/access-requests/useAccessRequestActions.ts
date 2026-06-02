'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import {
  approveAccessRequest,
  rejectAccessRequest,
} from '@/lib/api/admin';
import type {
  AccessRequestApproveInput,
  AccessRequestApproveResponse,
  AccessRequestRead,
} from '@/lib/api/schemas';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

import { adminAccessRequestsKey } from './queryKeys';

export type ApproveAccessRequestVariables = {
  id: string;
  org_name?: string;
  seat_limit?: number | null;
};

export function useApproveAccessRequest(): UseMutationResult<
  AccessRequestApproveResponse,
  Error,
  ApproveAccessRequestVariables
> {
  return useAuthMutation({
    mutationFn: (accessToken, { id, org_name, seat_limit }) => {
      const input: AccessRequestApproveInput = {};
      if (org_name !== undefined) input.org_name = org_name;
      if (seat_limit !== undefined) input.seat_limit = seat_limit;
      return approveAccessRequest(accessToken, id, input);
    },
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
