'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listModels } from '@/lib/api/models';
import type { ModelList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { modelsKey } from './queryKeys';

export function useModels(projectId: string): UseQueryResult<ModelList> {
  return useAuthQuery({
    queryKey: modelsKey(projectId),
    queryFn: (accessToken) => listModels(accessToken, projectId),
    enabled: projectId.length > 0,
  });
}
