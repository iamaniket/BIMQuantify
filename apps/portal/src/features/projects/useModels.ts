'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { listModels } from '@/lib/api/models';
import type { ModelList } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { modelsKey } from './queryKeys';

export function useModels(projectId: string): UseQueryResult<ModelList> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: modelsKey(projectId),
    queryFn: async (): Promise<ModelList> => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      return listModels(accessToken, projectId);
    },
    enabled: accessToken !== null && projectId.length > 0,
  });
}
