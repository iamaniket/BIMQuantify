'use client';

import type { UseMutationResult } from '@tanstack/react-query';

import { resendInvite } from '@/lib/api/members';
import { useAuthMutation } from '@/lib/query/useAuthQuery';

type Variables = { organizationId: string; userId: string };

export function useResendInvite(): UseMutationResult<void, Error, Variables> {
  return useAuthMutation({
    mutationFn: (accessToken, { organizationId, userId }) => resendInvite(accessToken, organizationId, userId),
  });
}
