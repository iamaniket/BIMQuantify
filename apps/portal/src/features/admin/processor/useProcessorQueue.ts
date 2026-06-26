'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getProcessorQueueStats } from '@/lib/api/adminJobs';
import type { ProcessorQueueStats } from '@/lib/api/schemas/adminJobs';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminProcessorQueueKey } from './queryKeys';

/** Live BullMQ queue depth. Polls every 10s; cheap (a single processor call). */
export function useProcessorQueue(): UseQueryResult<ProcessorQueueStats> {
  return useAuthQuery({
    queryKey: adminProcessorQueueKey(),
    queryFn: (accessToken) => getProcessorQueueStats(accessToken),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}
