'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listFindings } from '@/lib/api/findings';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Finding } from '@/lib/api/schemas';
import { useAuthInfiniteQuery } from '@/lib/query/useAuthInfiniteQuery';

import { elementFindingsKey } from './queryKeys';

export function useElementFindings(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  return useAuthInfiniteQuery({
    queryKey: elementFindingsKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken, offset, limit) => {
      if (globalId === null) throw new Error('Missing globalId');
      return listFindings(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
        limit,
        offset,
      });
    },
    enabled: globalId !== null,
  });
}
