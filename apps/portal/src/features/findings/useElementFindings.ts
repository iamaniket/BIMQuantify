'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listFindings } from '@/lib/api/findings';
import type { FindingList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { elementFindingsKey } from './queryKeys';

export function useElementFindings(
  projectId: string,
  fileId: string,
  globalId: string | null,
): UseQueryResult<FindingList> {
  return useAuthQuery({
    queryKey: elementFindingsKey(projectId, fileId, globalId ?? ''),
    queryFn: (accessToken) => {
      if (globalId === null) throw new Error('Missing globalId');
      return listFindings(accessToken, projectId, {
        linkedFileId: fileId,
        linkedElementGlobalId: globalId,
      });
    },
    enabled: globalId !== null,
    staleTime: 30_000,
  });
}
