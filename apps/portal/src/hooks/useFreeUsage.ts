'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getFreeUsage } from '@/lib/api/freeUsage';
import type { FreeUserUsage } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { useIsPooledContext } from './useIsPooledContext';

/**
 * The current free (org-less) user's usage vs. caps. Gated on the free context:
 * it only fires once `/auth/me` has resolved (`ready`) AND the user is in the
 * free workspace, so a paid user never hits the `/free/*` surface.
 */
export function useFreeUsage(): UseQueryResult<FreeUserUsage> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery<FreeUserUsage>({
    queryKey: ['free', 'usage'],
    queryFn: (token) => getFreeUsage(token),
    enabled: ready && isPooled,
  });
}
