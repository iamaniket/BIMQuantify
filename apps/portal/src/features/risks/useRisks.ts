'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listRisks } from '@/lib/api/risks';
import type { RiskList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { risksKey } from './queryKeys';

export function useRisks(projectId: string): UseQueryResult<RiskList> {
  return useAuthQuery({
    queryKey: risksKey(projectId),
    queryFn: (accessToken) => listRisks(accessToken, projectId),
  });
}
