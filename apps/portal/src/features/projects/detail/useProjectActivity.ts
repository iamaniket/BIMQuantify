'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getProjectActivity } from '@/lib/api/activity';
import type { ActivityCategory, ProjectActivityList } from '@/lib/api/schemas/activity';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

export function useProjectActivity(
  projectId: string,
  category?: ActivityCategory,
  limit = 50,
  since?: string,
): UseQueryResult<ProjectActivityList> {
  return useAuthQuery({
    queryKey: ['projects', projectId, 'activity', category ?? 'all', limit, since ?? 'all'] as const,
    queryFn: (accessToken) => getProjectActivity(accessToken, projectId, category, limit, since),
    enabled: projectId.length > 0,
  });
}
