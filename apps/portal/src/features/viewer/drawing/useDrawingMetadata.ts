'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { DrawingMetadataSchema, type DrawingMetadata } from '@/lib/api/schemas/geometry';

export function useDrawingMetadata(
  metadataUrl: string | null,
): UseQueryResult<DrawingMetadata> {
  return useQuery({
    queryKey: ['viewer', 'drawing-metadata', metadataUrl] as const,
    queryFn: async (): Promise<DrawingMetadata> => {
      const res = await fetch(metadataUrl!);
      if (!res.ok) throw new Error(`Failed to fetch drawing metadata: ${String(res.status)}`);
      return DrawingMetadataSchema.parse(await res.json());
    },
    enabled: metadataUrl !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}
