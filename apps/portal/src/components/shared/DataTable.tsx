'use client';

import { Fragment, type ReactNode } from 'react';

import {
  cn,
  Skeleton,
  SortableTableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

import type { Column } from './PageTable';
import type { SortState } from '@/lib/query/useTableQuery';

export type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: (item: T) => string | number;
  emptyMessage: ReactNode;
  /** Active sort (drives the header arrows). */
  sort: SortState;
  /** Toggle sort for a column's `sortKey`. */
  onToggleSort: (key: string) => void;
  isLoading: boolean;
  isError: boolean;
  errorMessage: ReactNode;
  /** Dim the body while a page transition is in flight (keepPreviousData). */
  isFetching?: boolean;
  skeletonRows?: number;
  rowClassName?: string | ((item: T) => string);
  onRowClick?: (item: T) => void;
  renderAfterRow?: (item: T, index: number) => ReactNode;
  /** Extra classes on the root flex column (e.g. to set `flex-1`). */
  className?: string;
};

/**
 * Full-height table region: a sticky-header scroll area that fills its flex
 * parent, with loading / error / empty states folded in. It renders neither the
 * toolbar (lives in the page shell's toolbar slot) nor the pagination footer
 * (rendered as a pinned sibling) — keeping each concern in one place.
 */
export function DataTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage,
  sort,
  onToggleSort,
  isLoading,
  isError,
  errorMessage,
  isFetching = false,
  skeletonRows = 10,
  rowClassName = 'hover:bg-background-hover',
  onRowClick,
  renderAfterRow,
  className,
}: DataTableProps<T>): ReactNode {
  const resolveRowClass = typeof rowClassName === 'function' ? rowClassName : () => rowClassName;
  const colCount = columns.length;

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="min-h-0 flex-1 overflow-auto px-5">
        <Table>
          <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:border-b [&_th]:border-border [&_th]:bg-background">
            <TableRow>
              {columns.map((col, i) =>
                col.sortKey !== undefined ? (
                  <SortableTableHead
                    key={i}
                    className={cn(col.className, col.headerClassName)}
                    active={sort?.key === col.sortKey}
                    direction={sort?.dir ?? 'asc'}
                    onSort={() => { onToggleSort(col.sortKey as string); }}
                  >
                    {col.header}
                  </SortableTableHead>
                ) : (
                  <TableHead key={i} className={cn(col.className, col.headerClassName)}>
                    {col.header}
                  </TableHead>
                ),
              )}
            </TableRow>
          </TableHeader>
          <TableBody className={cn(isFetching && 'opacity-60 transition-opacity')}>
            {isLoading ? (
              Array.from({ length: skeletonRows }, (_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell colSpan={colCount}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={colCount} className="py-10 text-center text-body3 text-error">
                  {errorMessage}
                </TableCell>
              </TableRow>
            ) : data.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="py-16 text-center text-body3 text-foreground-tertiary"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, index) => (
                <Fragment key={rowKey(item)}>
                  <TableRow
                    className={cn(resolveRowClass(item), onRowClick && 'cursor-pointer')}
                    onClick={onRowClick ? () => { onRowClick(item); } : undefined}
                  >
                    {columns.map((col, ci) => (
                      <TableCell key={ci} className={col.className}>
                        {col.cell(item, index)}
                      </TableCell>
                    ))}
                  </TableRow>
                  {renderAfterRow?.(item, index)}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
