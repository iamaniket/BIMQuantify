'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { getProject } from '@/lib/api/projects';
import type { Project } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectKey } from './queryKeys';

/** Free-aware: a free user's project is a pooled `free_project` served from
 * `/free/projects/{id}` (same `Project` shape). */
export function useProject(id: string): UseQueryResult<Project> {
  const { isFreeUser } = useIsFreeUser();
  return useAuthQuery({
    queryKey: projectKey(id),
    queryFn: (accessToken) =>
      getProject(accessToken, id, isFreeUser),
    enabled: id.length > 0,
  });
}
