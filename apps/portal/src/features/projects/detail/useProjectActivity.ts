'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getProjectActivity } from '@/lib/api/activity';
import type { ActivityCategory, ProjectActivityList } from '@/lib/api/schemas/activity';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

export function useProjectActivity(
  projectId: string,
  category?: ActivityCategory,
): UseQueryResult<ProjectActivityList> {
  return useAuthQuery({
    queryKey: ['projects', projectId, 'activity', category ?? 'all'] as const,
    queryFn: (accessToken) => getProjectActivity(accessToken, projectId, category),
    enabled: projectId.length > 0,
  });
}
