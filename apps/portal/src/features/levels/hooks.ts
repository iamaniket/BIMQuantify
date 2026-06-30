'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { listLevels } from '@/lib/api/levels';
import type { LevelList } from '@/lib/api/schemas';
import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { levelsKey } from './queryKeys';

/** Free-aware: free projects now have their own pooled Levels (`/pooled/projects/
 * {id}/levels`, identical paid schema), so both tiers fetch the real list. */
export function useProjectLevels(projectId: string): UseQueryResult<LevelList> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: levelsKey(projectId),
    queryFn: (accessToken) => listLevels(accessToken, projectId, isPooled),
    // `ready` defers the fetch until /auth/me resolves the free/paid branch (409).
    enabled: ready && projectId.length > 0,
  });
}
