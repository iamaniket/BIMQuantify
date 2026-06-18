'use client';

import {
  keepPreviousData,
  useQuery,
  type QueryKey,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SortDirection } from '@bimstitch/ui';

import { ApiError, type PaginatedResponse } from '@/lib/api/client';
import { tokenManager } from '@/lib/auth/tokenManager';
import { useAuth } from '@/providers/AuthProvider';

/** Active column sort, or `null` for the endpoint's default order. */
export type SortState = { key: string; dir: SortDirection } | null;

/** Pagination + sort params appended to every list request. */
export type TableListParams = {
  limit: number;
  offset: number;
  order_by?: string | undefined;
  order_dir?: SortDirection | undefined;
};

/**
 * The single shape both the server (`useTableQuery`) and client
 * (`useClientPagination`) hooks return, so `DataTable` + `Pagination` consume
 * them interchangeably.
 */
export type TablePagination<TItem> = {
  rows: TItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  sort: SortState;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Cycle the sort on a column: inactive → asc → desc → asc … */
  toggleSort: (key: string) => void;
};

const DEFAULT_PAGE_SIZE = 25;

function is401(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

function nextSort(prev: SortState, key: string): SortState {
  if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: 'asc' };
}

function deriveRange(
  total: number,
  page: number,
  pageSize: number,
  rowCount: number,
): { rangeStart: number; rangeEnd: number; pageCount: number } {
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  if (rowCount === 0 || total === 0) return { rangeStart: 0, rangeEnd: 0, pageCount };
  const rangeStart = (page - 1) * pageSize + 1;
  return { rangeStart, rangeEnd: rangeStart + rowCount - 1, pageCount };
}

// ---------------------------------------------------------------------------
// Server-side pagination
// ---------------------------------------------------------------------------

type UseTableQueryOptions<TItem, TFilters extends Record<string, unknown>> = {
  /** Filter values owned by the page (search, status, …). Changing any resets
   * to page 1. Must be JSON-serialisable so changes can be detected. */
  filters: TFilters;
  /** React Query key derived from the merged filter + pagination params. */
  queryKey: (params: TFilters & TableListParams) => QueryKey;
  /** Fetcher returning the page items + total (via `apiClient.getWithMeta`). */
  queryFn: (
    accessToken: string,
    params: TFilters & TableListParams,
  ) => Promise<PaginatedResponse<TItem[]>>;
  initialPageSize?: number;
  initialSort?: SortState;
  enabled?: boolean;
};

/**
 * Server-paginated, server-sorted list backed by `apiClient.getWithMeta`
 * (reads `X-Total-Count`). Holds page / pageSize / sort state, resets to page 1
 * whenever the filters or sort change, and keeps the previous page visible while
 * the next loads (no flash) via `keepPreviousData`.
 */
export function useTableQuery<TItem, TFilters extends Record<string, unknown>>(
  options: UseTableQueryOptions<TItem, TFilters>,
): TablePagination<TItem> {
  const {
    filters,
    queryKey,
    queryFn,
    initialPageSize = DEFAULT_PAGE_SIZE,
    initialSort = null,
    enabled,
  } = options;

  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [sort, setSort] = useState<SortState>(initialSort);

  // Reset to the first page whenever the filter set changes (a deeper result
  // set than the current page would otherwise show "page 5 of 1").
  const filtersKey = JSON.stringify(filters);
  const prevFiltersKey = useRef(filtersKey);
  useEffect(() => {
    if (prevFiltersKey.current !== filtersKey) {
      prevFiltersKey.current = filtersKey;
      setPageState(1);
    }
  }, [filtersKey]);

  const params = useMemo<TFilters & TableListParams>(
    () => ({
      ...filters,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order_by: sort?.key,
      order_dir: sort?.dir,
    }),
    [filters, pageSize, page, sort],
  );

  const query = useQuery({
    queryKey: queryKey(params),
    queryFn: async () => {
      if (accessToken === null) throw new Error('Not authenticated');
      try {
        return await queryFn(accessToken, params);
      } catch (error) {
        if (is401(error)) {
          const newToken = await tokenManager.refresh();
          return queryFn(newToken, params);
        }
        throw error;
      }
    },
    enabled: accessToken !== null && (enabled ?? true),
    placeholderData: keepPreviousData,
  });

  const rows = query.data?.data ?? [];
  const total = query.data?.totalCount ?? rows.length;
  const { rangeStart, rangeEnd, pageCount } = deriveRange(total, page, pageSize, rows.length);

  const setPage = useCallback((p: number) => { setPageState(p); }, []);
  const setPageSize = useCallback((s: number) => {
    setPageSizeState(s);
    setPageState(1);
  }, []);
  const toggleSort = useCallback((key: string) => {
    setSort((prev) => nextSort(prev, key));
    setPageState(1);
  }, []);

  return {
    rows,
    total,
    page,
    pageSize,
    pageCount,
    rangeStart,
    rangeEnd,
    sort,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    setPage,
    setPageSize,
    toggleSort,
  };
}

// ---------------------------------------------------------------------------
// Client-side pagination (for merged / already-loaded datasets, e.g. Templates)
// ---------------------------------------------------------------------------

type UseClientPaginationOptions<TItem> = {
  /** Per-sort-key value accessor used to compare rows. Keys must match the
   * `sortKey` on the columns. Returning a string sorts case-insensitively. */
  sortAccessors?: Record<string, (item: TItem) => string | number | boolean | null | undefined>;
  initialPageSize?: number;
  initialSort?: SortState;
  isLoading?: boolean;
  isError?: boolean;
};

function compareValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last
  if (b == null) return -1;
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * In-memory pagination + sorting over a fully-loaded array. Same return shape
 * as `useTableQuery`. Used where there is no single server list to page — e.g.
 * the Templates screen merges finding + report templates client-side.
 */
export function useClientPagination<TItem>(
  allRows: TItem[],
  options: UseClientPaginationOptions<TItem> = {},
): TablePagination<TItem> {
  const {
    sortAccessors,
    initialPageSize = DEFAULT_PAGE_SIZE,
    initialSort = null,
    isLoading = false,
    isError = false,
  } = options;

  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [sort, setSort] = useState<SortState>(initialSort);

  const total = allRows.length;

  // Reset to page 1 when the underlying set shrinks/changes shape.
  const prevTotal = useRef(total);
  useEffect(() => {
    if (prevTotal.current !== total) {
      prevTotal.current = total;
      setPageState(1);
    }
  }, [total]);

  const sorted = useMemo(() => {
    if (sort === null || sortAccessors === undefined) return allRows;
    const accessor = sortAccessors[sort.key];
    if (accessor === undefined) return allRows;
    const factor = sort.dir === 'asc' ? 1 : -1;
    return [...allRows].sort((a, b) => factor * compareValues(accessor(a), accessor(b)));
  }, [allRows, sort, sortAccessors]);

  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const safePage = Math.min(page, pageCount);
  const offset = (safePage - 1) * pageSize;
  const rows = sorted.slice(offset, offset + pageSize);
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = total === 0 ? 0 : offset + rows.length;

  const setPage = useCallback((p: number) => { setPageState(p); }, []);
  const setPageSize = useCallback((s: number) => {
    setPageSizeState(s);
    setPageState(1);
  }, []);
  const toggleSort = useCallback((key: string) => {
    setSort((prev) => nextSort(prev, key));
    setPageState(1);
  }, []);

  return {
    rows,
    total,
    page: safePage,
    pageSize,
    pageCount,
    rangeStart,
    rangeEnd,
    sort,
    isLoading,
    isFetching: false,
    isError,
    setPage,
    setPageSize,
    toggleSort,
  };
}
