'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { getProjectOverview } from '@/lib/api/projects';
import type { ProjectOverview } from '@/lib/api/schemas';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectOverviewKey } from './queryKeys';

/**
 * The project-detail dashboard's single data source. One aggregate request
 * feeds the header KPIs, completeness donut, the four launcher cards and the
 * deadlines/readiness panels — every consumer subscribes to this one query
 * (optionally narrowing to its slice via `select`), so the cold load is a
 * single round trip instead of the ~10 per-resource requests it replaces.
 *
 * Pass a stable `select` that returns a sub-property of the payload (e.g.
 * `(o) => o.findings`) — those keep their reference across renders, so the
 * subscribing card only re-renders when its own slice changes.
 */
export function useProjectOverview<TSelect = ProjectOverview>(
  projectId: string,
  select?: (data: ProjectOverview) => TSelect,
): UseQueryResult<TSelect> {
  return useAuthQuery<ProjectOverview, TSelect>({
    queryKey: projectOverviewKey(projectId),
    queryFn: (accessToken) => getProjectOverview(accessToken, projectId),
    enabled: projectId.length > 0,
    // `exactOptionalPropertyTypes` forbids passing `select: undefined`, so only
    // include the key when a selector was actually supplied.
    ...(select !== undefined ? { select } : {}),
  });
}
