'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getAdminActiveJobs } from '@/lib/api/adminJobs';
import type { AdminActiveJobs } from '@/lib/api/schemas/adminJobs';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminProcessorActiveKey } from './queryKeys';

/**
 * Live ongoing + stuck jobs across all orgs. Polls every 10s — the fetch only
 * ever touches non-terminal jobs (tiny sets), never job history.
 */
export function useAdminActiveJobs(limit = 200): UseQueryResult<AdminActiveJobs> {
  return useAuthQuery({
    queryKey: adminProcessorActiveKey(limit),
    queryFn: (accessToken) => getAdminActiveJobs(accessToken, { limit }),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}
