'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getBorgingsplan } from '@/lib/api/borgingsplan';
import type { Borgingsplan } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { borgingsplanKey } from './queryKeys';

export function useBorgingsplan(
  projectId: string,
): UseQueryResult<Borgingsplan | null> {
  return useAuthQuery({
    queryKey: borgingsplanKey(projectId),
    queryFn: (accessToken) => getBorgingsplan(accessToken, projectId),
  });
}
