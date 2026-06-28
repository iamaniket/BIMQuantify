'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listFindingComments } from '@/lib/api/findings';
import type { FindingCommentList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { findingCommentsKey } from './queryKeys';

/** Discussion thread for one finding (oldest first). Mirrors useFindingHistory. */
export function useFindingComments(
  projectId: string,
  findingId: string | null,
  enabled = true,
): UseQueryResult<FindingCommentList> {
  return useAuthQuery({
    queryKey: findingCommentsKey(projectId, findingId ?? ''),
    queryFn: (accessToken) => {
      if (findingId === null) throw new Error('Missing findingId');
      return listFindingComments(accessToken, projectId, findingId);
    },
    enabled: enabled && findingId !== null,
    staleTime: 30_000,
  });
}
