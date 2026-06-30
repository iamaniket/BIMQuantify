'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { listFindings } from '@/lib/api/findings';
import { listPooledFindings } from '@/lib/api/pooledFindings';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Finding } from '@/lib/api/schemas';
import { useAuthInfiniteQuery } from '@/lib/query/useAuthInfiniteQuery';

import { elementFindingsKey } from './queryKeys';

export function useElementFindings(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Finding[]>>> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthInfiniteQuery({
    queryKey: elementFindingsKey(projectId, modelId, globalId ?? ''),
    // Free-aware: free has no server element filter. `modelId` is the container
    // id, so we list its snags and filter by GlobalId client-side.
    queryFn: isPooled
      ? async (accessToken) => {
          if (globalId === null) throw new Error('Missing globalId');
          // The free endpoint already emits the paid `Finding` shape; just filter
          // by GlobalId client-side (free has no server element filter).
          const data = (await listPooledFindings(accessToken, modelId)).filter(
            (f) => f.linked_element_global_id === globalId,
          );
          return { data, totalCount: data.length };
        }
      : (accessToken, offset, limit) => {
          if (globalId === null) throw new Error('Missing globalId');
          return listFindings(accessToken, projectId, {
            linkedModelId: modelId,
            linkedElementGlobalId: globalId,
            limit,
            offset,
          });
        },
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && globalId !== null,
  });
}
