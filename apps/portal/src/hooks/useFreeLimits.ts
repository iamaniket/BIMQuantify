'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getFreeLimits } from '@/lib/api/freeUsage';
import type { FreeAccountLimits } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { useIsFreeUser } from './useIsFreeUser';

/**
 * The current free (org-less) user's effective caps + trial countdown. Gated on
 * the free context (only fires once `/auth/me` has resolved AND the user is in
 * the free workspace), so a paid user never hits the `/free/*` surface. Drives
 * the {@link TrialBanner}.
 */
export function useFreeLimits(): UseQueryResult<FreeAccountLimits> {
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthQuery<FreeAccountLimits>({
    queryKey: ['free', 'limits'],
    queryFn: (token) => getFreeLimits(token),
    enabled: ready && isFreeUser,
  });
}
