'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { MapMarker } from '@bimstitch/map';
import { z } from 'zod';

import { apiClient } from '@/lib/api/client';

const ProjectsMapPointSchema = z.object({
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  count: z.number().int().min(1),
});

const ProjectsMapResponseSchema = z.array(ProjectsMapPointSchema);

export type ProjectsMapPoint = z.infer<typeof ProjectsMapPointSchema>;

/**
 * Fetches anonymized project locations from `/public/projects-map` and
 * shapes them as `MapMarker[]` for the `<NetherlandsMap />` component.
 *
 * Public, unauthenticated. 5-minute stale time because the underlying data
 * changes slowly (new projects every few hours at most).
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
      return points.map((p): MapMarker => ({
        lat: p.lat,
        lng: p.lng,
        label: p.city,
        count: p.count,
      }));
    },
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
