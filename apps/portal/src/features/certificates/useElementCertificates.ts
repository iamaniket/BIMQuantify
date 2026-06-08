'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { listCertificates } from '@/lib/api/certificates';
import type { PaginatedResponse } from '@/lib/api/client';
import type { Certificate } from '@/lib/api/schemas';
import { useAuthInfiniteQuery } from '@/lib/query/useAuthInfiniteQuery';

import { elementCertificatesKey } from './queryKeys';

export function useElementCertificates(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<Certificate[]>>> {
  return useAuthInfiniteQuery({
    queryKey: elementCertificatesKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken, offset, limit) => {
      if (globalId === null) throw new Error('Missing globalId');
      return listCertificates(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
        limit,
        offset,
      });
    },
    enabled: globalId !== null,
  });
}
