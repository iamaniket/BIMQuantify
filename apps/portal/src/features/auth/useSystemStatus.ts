'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { apiClient } from '@/lib/api/client';

const SystemStatusSchema = z.object({
  status: z.enum(['normal', 'degraded', 'down']),
  region: z.string(),
  node: z.string(),
  wkb_version: z.string(),
  bbl_version: z.string(),
  ifc_version: z.string(),
  checks: z.record(z.string(), z.boolean()),
});

export type SystemStatus = z.infer<typeof SystemStatusSchema>;

/**
 * Fetches the public health summary (`/public/system-status`) and refreshes
 * every 60 seconds. Used on the login page status badge + KPI strip. No
 * auth header is sent — the endpoint is public.
 */
export function useSystemStatus(): UseQueryResult<SystemStatus, Error> {
  return useQuery<SystemStatus, Error>({
    queryKey: ['public', 'system-status'],
    queryFn: async () =>
      apiClient.get('/public/system-status', SystemStatusSchema, undefined),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
