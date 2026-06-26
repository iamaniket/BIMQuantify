import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ApiError } from '@/lib/api/client';
import { tokenManager } from '@/lib/api/tokenManager';
import { getList, getOne, putList, putOne, type CacheableRow } from '@/lib/offline/cache';
import { useAuth } from '@/providers/AuthProvider';

// Online-first, cache-fallback query helpers backed by the SQLite read mirror.
// Online: fetch, write-through to the cache, return fresh data. Offline (or on a
// connectivity error): serve the cached rows. A real HTTP error (the server
// responded — e.g. 403/404) is NOT a connectivity failure, so it rethrows
// rather than masking the error with stale cache.

async function runWithRefresh<T>(token: string, fn: (t: string) => Promise<T>): Promise<T> {
  try {
    return await fn(token);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const fresh = await tokenManager.refresh();
      return fn(fresh);
    }
    throw error;
  }
}

/** A non-ApiError (e.g. a fetch TypeError) means the server was unreachable. */
function isConnectivityError(error: unknown): boolean {
  return !(error instanceof ApiError);
}

export function useOfflineListQuery<T extends CacheableRow>(
  queryKey: readonly unknown[],
  entity: string,
  scope: string,
  fn: (token: string) => Promise<T[]>,
  options?: { enabled?: boolean },
): UseQueryResult<T[], Error> {
  const { tokens } = useAuth();
  const token = tokens?.access_token ?? null;
  return useQuery<T[], Error>({
    queryKey,
    enabled: (options?.enabled ?? true) && token !== null,
    // We handle offline ourselves (cache fallback), so don't let RQ pause us.
    networkMode: 'always',
    queryFn: async () => {
      if (token === null) throw new Error('Not authenticated');
      try {
        const data = await runWithRefresh(token, fn);
        await putList(entity, scope, data);
        return data;
      } catch (error) {
        if (isConnectivityError(error)) {
          const cached = await getList<T>(entity, scope);
          if (cached.length > 0) return cached;
        }
        throw error;
      }
    },
  });
}

export function useOfflineItemQuery<T extends CacheableRow>(
  queryKey: readonly unknown[],
  entity: string,
  scope: string,
  id: string,
  fn: (token: string) => Promise<T>,
  options?: { enabled?: boolean },
): UseQueryResult<T, Error> {
  const { tokens } = useAuth();
  const token = tokens?.access_token ?? null;
  return useQuery<T, Error>({
    queryKey,
    enabled: (options?.enabled ?? true) && token !== null && id.length > 0,
    networkMode: 'always',
    queryFn: async () => {
      if (token === null) throw new Error('Not authenticated');
      try {
        const data = await runWithRefresh(token, fn);
        await putOne(entity, scope, data);
        return data;
      } catch (error) {
        if (isConnectivityError(error)) {
          const cached = await getOne<T>(entity, scope, id);
          if (cached !== null) return cached;
        }
        throw error;
      }
    },
  });
}
