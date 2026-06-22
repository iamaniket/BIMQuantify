'use client';

import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useEffect } from 'react';

import type { PaginatedResponse } from '@/lib/api/client';

import { flattenPages, totalFromPages } from './useAuthInfiniteQuery';

type InfiniteResult<T> = UseInfiniteQueryResult<InfiniteData<PaginatedResponse<T[]>>>;

export type AllInfinitePages<T> = {
  /** Every item across all pages, flattened. */
  items: T[];
  /** Server-reported total (falls back to the loaded count). */
  total: number;
  /** True until every page is in — so callers can show skeletons rather than a
   * misleading partial set. */
  isLoading: boolean;
  isError: boolean;
};

/**
 * Drains an infinite query: keeps calling `fetchNextPage()` until there are no
 * more pages, then returns the fully-flattened list. Lets list views that need
 * the *complete* set — client-side sort/paginate (`useClientPagination`) and
 * aggregate overviews — reuse the existing infinite hooks (`useCertificates`,
 * `useAttachments`) without a dedicated "fetch all" endpoint.
 *
 * Fine at the volumes these lists see (typically a handful of 50-row pages). If
 * a project's list ever grows large enough to matter, add server sort to the
 * route and switch the page to `useTableQuery` — the consuming `DataTable` is
 * unaffected.
 */
export function useAllInfinitePages<T>(query: InfiniteResult<T>): AllInfinitePages<T> {
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return {
    items: flattenPages(query.data),
    total: totalFromPages(query.data),
    isLoading: query.isLoading || query.hasNextPage === true,
    isError: query.isError,
  };
}
