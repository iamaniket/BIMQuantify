'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';

import { getProjectActivity } from '@/lib/api/activity';
import type { PaginatedResponse } from '@/lib/api/client';
import type { ActivityCategory, ProjectActivityEntry } from '@/lib/api/schemas/activity';
import { useAuthInfiniteQuery } from '@/lib/query/useAuthInfiniteQuery';

const PAGE_SIZE = 25;

export function useProjectActivity(
  projectId: string,
  category?: ActivityCategory,
  since?: string,
): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<ProjectActivityEntry[]>>> {
  return useAuthInfiniteQuery({
    queryKey: ['projects', projectId, 'activity', category ?? 'all', since ?? 'all'] as const,
    queryFn: (accessToken, offset, limit) =>
      getProjectActivity(accessToken, projectId, category, limit, offset, since),
    enabled: projectId.length > 0,
    pageSize: PAGE_SIZE,
  });
}
