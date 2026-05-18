'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getBorgingsplan, listBorgingsplanVersions } from '@/lib/api/borgingsplan';
import type {
  Borgingsplan,
  BorgingsplanVersionSummary,
} from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { borgingsplanKey, borgingsplanVersionsKey } from './queryKeys';

export function useBorgingsplan(
  projectId: string,
): UseQueryResult<Borgingsplan | null> {
  return useAuthQuery({
    queryKey: borgingsplanKey(projectId),
    queryFn: (accessToken) => getBorgingsplan(accessToken, projectId),
  });
}

export function useBorgingsplanVersions(
  projectId: string,
): UseQueryResult<BorgingsplanVersionSummary[]> {
  return useAuthQuery({
    queryKey: borgingsplanVersionsKey(projectId),
    queryFn: (accessToken) => listBorgingsplanVersions(accessToken, projectId),
  });
}
