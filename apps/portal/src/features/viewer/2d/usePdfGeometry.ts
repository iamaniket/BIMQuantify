'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { GeometryArtifactSchema, type GeometryArtifact } from '@/lib/api/schemas/geometry';

export function usePdfGeometry(
  geometryUrl: string | null,
): UseQueryResult<GeometryArtifact> {
  return useQuery({
    queryKey: ['viewer', 'pdf-geometry', geometryUrl] as const,
    queryFn: async (): Promise<GeometryArtifact> => {
      const res = await fetch(geometryUrl!);
      if (!res.ok) throw new Error(`Failed to fetch PDF geometry: ${String(res.status)}`);
      return GeometryArtifactSchema.parse(await res.json());
    },
    enabled: geometryUrl !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}
