'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Pagination } from '@bimstitch/ui';

import type { TablePagination } from '@/lib/query/useTableQuery';

/**
 * The shared, pinned pagination footer. Maps the `common.pagination` i18n
 * catalog onto the pure `@bimstitch/ui` `Pagination` and the `TablePagination`
 * hook result, so every migrated table renders an identical footer with one
 * line of JSX. Render it as a `shrink-0` sibling below `DataTable`.
 */
export function TablePaginationFooter<T>({
  table,
  className,
  pageSizeOptions,
}: {
  table: TablePagination<T>;
  className?: string;
  /** Override the page-size choices (default `[10, 25, 50, 100]`). */
  pageSizeOptions?: readonly number[];
}): ReactNode {
  const t = useTranslations('common.pagination');

  return (
    <Pagination
      page={table.page}
      pageCount={table.pageCount}
      pageSize={table.pageSize}
      {...(pageSizeOptions !== undefined ? { pageSizeOptions } : {})}
      onPageChange={table.setPage}
      onPageSizeChange={table.setPageSize}
      disabled={table.isLoading}
      className={className}
      pageAriaLabel={(n) => t('goToPage', { page: n })}
      labels={{
        rowsPerPage: t('rowsPerPage'),
        range:
          table.total === 0
            ? t('empty')
            : t('range', {
              from: table.rangeStart,
              to: table.rangeEnd,
              total: table.total,
            }),
        first: t('first'),
        previous: t('previous'),
        next: t('next'),
        last: t('last'),
      }}
    />
  );
}
