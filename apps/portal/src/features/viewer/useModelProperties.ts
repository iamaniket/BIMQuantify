'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ModelProperties } from '@/lib/api/viewerTypes';

export function useModelProperties(
  propertiesUrl: string | null,
  enabled: boolean,
): UseQueryResult<ModelProperties> {
  return useQuery({
    queryKey: ['viewer', 'properties', propertiesUrl] as const,
    queryFn: async (): Promise<ModelProperties> => {
      const res = await fetch(propertiesUrl!);
      if (!res.ok) throw new Error(`Failed to fetch properties: ${String(res.status)}`);
      return res.json() as Promise<ModelProperties>;
    },
    enabled: enabled && propertiesUrl !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}
