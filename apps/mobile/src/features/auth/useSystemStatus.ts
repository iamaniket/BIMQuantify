import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { apiClient } from '@/lib/api/client';
import { SystemStatusSchema, type SystemStatus } from '@/lib/api/schemas/public';

/**
 * Public platform-health summary that drives the login KPI strip (WKB / BBL /
 * IFC versions) and the status row. Unauthenticated. Ported from
 * apps/portal/src/features/auth/useSystemStatus.ts; refreshes every 60s.
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
