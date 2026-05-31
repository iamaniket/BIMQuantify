'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listFindings } from '@/lib/api/findings';
import type { FindingList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { elementFindingsKey } from './queryKeys';

export function useElementFindings(
  projectId: string,
  modelId: string,
  globalId: string | null,
): UseQueryResult<FindingList> {
  return useAuthQuery({
    queryKey: elementFindingsKey(projectId, modelId, globalId ?? ''),
    queryFn: (accessToken) => {
      if (globalId === null) throw new Error('Missing globalId');
      // Version-independent identity: (model, GlobalId). A finding raised on any
      // version of the model surfaces here regardless of the open file version.
      return listFindings(accessToken, projectId, {
        linkedModelId: modelId,
        linkedElementGlobalId: globalId,
      });
    },
    enabled: globalId !== null,
    staleTime: 30_000,
  });
}
