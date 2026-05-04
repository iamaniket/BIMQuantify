'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ModelMetadata } from '@/lib/api/viewerTypes';

export function useModelMetadata(
  metadataUrl: string | null,
): UseQueryResult<ModelMetadata> {
  return useQuery({
    queryKey: ['viewer', 'metadata', metadataUrl] as const,
    queryFn: async (): Promise<ModelMetadata> => {
      const res = await fetch(metadataUrl!);
      if (!res.ok) throw new Error(`Failed to fetch metadata: ${String(res.status)}`);
      return res.json() as Promise<ModelMetadata>;
    },
    enabled: metadataUrl !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}
