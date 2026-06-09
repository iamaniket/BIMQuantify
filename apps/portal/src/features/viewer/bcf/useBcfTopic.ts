'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getBcfTopic } from '@/lib/api/bcf';
import type { BcfTopicRead } from '@/lib/api/schemas/bcf';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { bcfKeys } from './queryKeys';

export function useBcfTopic(
  projectId: string,
  topicId: string | null,
): UseQueryResult<BcfTopicRead> {
  return useAuthQuery({
    queryKey: bcfKeys.detail(projectId, topicId ?? ''),
    queryFn: (accessToken) => getBcfTopic(accessToken, projectId, topicId!),
    enabled: topicId !== null,
  });
}
