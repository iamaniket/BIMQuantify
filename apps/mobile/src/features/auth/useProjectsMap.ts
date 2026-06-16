import type { MapMarker } from '@bimstitch/map';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { ProjectsMapResponseSchema } from '@/lib/api/schemas/public';

/**
 * Anonymized, aggregated project locations for the login hero map, shaped as
 * `MapMarker[]` for `NlMap`. Public + unauthenticated (no access token) — the
 * login screen runs before any token exists.
 *
 * Ported 1:1 from apps/portal/src/features/auth/useProjectsMap.ts; 5-minute
 * stale time because the underlying data changes slowly.
 */
export function useProjectsMap(): UseQueryResult<MapMarker[], Error> {
  return useQuery<MapMarker[], Error>({
    queryKey: ['public', 'projects-map'],
    queryFn: async () => {
      const points = await apiClient.get(
        '/public/projects-map',
        ProjectsMapResponseSchema,
        undefined,
      );
      return points.map(
        (p): MapMarker => ({
          lat: p.lat,
          lng: p.lng,
          label: p.city,
          count: p.count,
        }),
      );
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
