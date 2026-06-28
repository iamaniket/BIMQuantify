'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { useIsFreeUser } from '@/hooks/useIsFreeUser';
import { listFreeProjects } from '@/lib/api/freeProjects';
import { listProjects } from '@/lib/api/projects';
import type { ProjectList } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectsKey } from './queryKeys';

/**
 * Free-aware: an org-less (free) user lists their pooled `free_projects` via the
 * `/free/*` surface — which returns the identical `ProjectList` shape — while a
 * paid user keeps the org-scoped `/projects` path unchanged. Gated on `ready` so
 * we never fire the wrong endpoint before `/auth/me` tells us which tier this is.
 */
export function useProjects(): UseQueryResult<ProjectList> {
  const { isFreeUser, ready } = useIsFreeUser();
  return useAuthQuery({
    queryKey: projectsKey,
    queryFn: (accessToken) =>
      isFreeUser ? listFreeProjects(accessToken) : listProjects(accessToken),
    enabled: ready,
  });
}
