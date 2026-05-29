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
