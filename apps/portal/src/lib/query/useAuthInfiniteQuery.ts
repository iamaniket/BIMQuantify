'use client';

import { useMemo } from 'react';
import {
  useInfiniteQuery,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import { ApiError, type PaginatedResponse } from '@/lib/api/client';
import { tokenManager } from '@/lib/auth/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

function is401(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

const DEFAULT_PAGE_SIZE = 50;

type AuthInfiniteQueryOptions<TItem, TKey extends QueryKey = QueryKey> = {
  queryKey: TKey;
  queryFn: (accessToken: string, offset: number, limit: number) => Promise<PaginatedResponse<TItem[]>>;
  enabled?: boolean;
  pageSize?: number;
  staleTime?: number;
};

export function useAuthInfiniteQuery<
  TItem,
  TKey extends QueryKey = QueryKey,
>(options: AuthInfiniteQueryOptions<TItem, TKey>): UseInfiniteQueryResult<InfiniteData<PaginatedResponse<TItem[]>>> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  const { queryFn, enabled, pageSize = DEFAULT_PAGE_SIZE, ...rest } = options;

  return useInfiniteQuery({
    ...rest,
    initialPageParam: 0,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (accessToken === null) throw new Error('Not authenticated');
      try {
        return await queryFn(accessToken, pageParam, pageSize);
      } catch (error) {
        if (is401(error)) {
          const newToken = await tokenManager.refresh();
          return queryFn(newToken, pageParam, pageSize);
        }
        throw error;
      }
    },
    getNextPageParam: (lastPage: PaginatedResponse<TItem[]>, _allPages: PaginatedResponse<TItem[]>[], lastPageParam: number) => {
      const nextOffset = lastPageParam + pageSize;
      if (lastPage.totalCount !== null) {
        return nextOffset >= lastPage.totalCount ? undefined : nextOffset;
      }
      return lastPage.data.length < pageSize ? undefined : nextOffset;
    },
    enabled: accessToken !== null && (enabled ?? true),
  });
}

export function flattenPages<T>(data: InfiniteData<PaginatedResponse<T[]>> | undefined): T[] {
  if (data === undefined) return [];
  return data.pages.flatMap((page) => page.data);
}

/**
 * Memoized {@link flattenPages}. TanStack Query keeps `data` referentially
 * stable across renders (structural sharing), so flattening only recomputes
 * when the query result actually changes. Call this instead of
 * `flattenPages(query.data)` in a render body — the bare call returns a fresh
 * array every render, which silently defeats any downstream `useMemo`/`memo`
 * that depends on the flattened list.
 */
export function useFlattenedPages<T>(
  data: InfiniteData<PaginatedResponse<T[]>> | undefined,
): T[] {
  return useMemo(() => flattenPages(data), [data]);
}

export function totalFromPages<T>(data: InfiniteData<PaginatedResponse<T[]>> | undefined): number {
  if (data === undefined) return 0;
  const firstPage = data.pages[0];
  if (firstPage !== undefined && firstPage.totalCount !== null) return firstPage.totalCount;
  return data.pages.reduce((sum, page) => sum + page.data.length, 0);
}
