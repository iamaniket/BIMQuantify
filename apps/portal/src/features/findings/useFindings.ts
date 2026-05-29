'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listFindings } from '@/lib/api/findings';
import type { FindingList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { findingsKey } from './queryKeys';

export function useFindings(projectId: string): UseQueryResult<FindingList> {
  return useAuthQuery({
    queryKey: findingsKey(projectId),
    queryFn: (accessToken) => listFindings(accessToken, projectId),
  });
}

export function useFileFindingCount(
  projectId: string,
  fileId: string | null,
): number {
  const query = useAuthQuery({
    queryKey: [...findingsKey(projectId), 'file', fileId ?? ''] as const,
    queryFn: (accessToken) => {
      if (fileId === null) throw new Error('Missing fileId');
      return listFindings(accessToken, projectId, { linkedFileId: fileId });
    },
    enabled: fileId !== null,
    staleTime: 30_000,
  });
  return query.data?.length ?? 0;
}
