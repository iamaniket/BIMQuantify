'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getFindingHistory } from '@/lib/api/findings';
import type { FindingHistoryList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { findingHistoryKey } from './queryKeys';

export function useFindingHistory(
  projectId: string,
  findingId: string | null,
  enabled = true,
): UseQueryResult<FindingHistoryList> {
  return useAuthQuery({
    queryKey: findingHistoryKey(projectId, findingId ?? ''),
    queryFn: (accessToken) => {
      if (findingId === null) throw new Error('Missing findingId');
      return getFindingHistory(accessToken, projectId, findingId);
    },
    enabled: enabled && findingId !== null,
    staleTime: 30_000,
  });
}
