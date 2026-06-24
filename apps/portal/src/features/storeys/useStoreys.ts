'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listStoreys } from '@/lib/api/storeys';
import type { StoreyList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { storeysKey } from './queryKeys';

export function useStoreys(
  projectId: string,
  modelId: string,
): UseQueryResult<StoreyList> {
  return useAuthQuery({
    queryKey: storeysKey(projectId, modelId),
    queryFn: (accessToken) => listStoreys(accessToken, projectId, modelId),
    enabled: projectId.length > 0 && modelId.length > 0,
  });
}
