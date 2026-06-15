import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';
import { tokenManager } from '@/lib/api/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

/**
 * Authed query helper, mirroring the portal's useAuthQuery: runs `fn` with the
 * current access token and, on a 401, refreshes once via tokenManager and
 * retries. Disabled until tokens hydrate.
 */
export function useAuthQuery<T>(
  queryKey: readonly unknown[],
  fn: (accessToken: string) => Promise<T>,
  options?: { enabled?: boolean },
): UseQueryResult<T, Error> {
  const { tokens } = useAuth();
  const accessToken = tokens?.access_token ?? null;

  return useQuery<T, Error>({
    queryKey,
    enabled: (options?.enabled ?? true) && accessToken !== null,
    queryFn: async () => {
      if (accessToken === null) {
        throw new Error('Not authenticated');
      }
      try {
        return await fn(accessToken);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const fresh = await tokenManager.refresh();
          return fn(fresh);
        }
        throw error;
      }
    },
  });
}
