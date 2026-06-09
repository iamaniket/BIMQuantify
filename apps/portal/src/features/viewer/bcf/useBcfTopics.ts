'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listBcfTopics, type BcfListParams } from '@/lib/api/bcf';
import type { BcfTopicList } from '@/lib/api/schemas/bcf';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

export function useBcfTopics(
  projectId: string,
  params?: BcfListParams,
): UseQueryResult<BcfTopicList> {
  return useAuthQuery({
    queryKey: [...bcfKeys.list(projectId), params] as const,
    queryFn: (accessToken) => listBcfTopics(accessToken, projectId, params),
  });
}
