'use client';

import { Search } from '@bimstitch/ui/icons';
import { Fragment, type ReactNode } from 'react';

import {
  cn,
  Input,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bimstitch/ui';

export type Column<T> = {
  header: ReactNode;
  className?: string;
  headerClassName?: string;
  cell: (item: T, index: number) => ReactNode;
};

export type PageTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  rowKey: (item: T) => string | number;
  emptyMessage: ReactNode;
  rowClassName?: string | ((item: T) => string);
  renderAfterRow?: (item: T, index: number) => ReactNode;
  renderBefore?: ReactNode;
  renderAfter?: ReactNode;
};

export function PageTable<T>({
  columns,
  data,
  rowKey,
  emptyMessage,
  rowClassName = 'hover:bg-background-hover',
  renderAfterRow,
  renderBefore,
  renderAfter,
}: PageTableProps<T>): ReactNode {
  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-body3 text-foreground-tertiary">
        {emptyMessage}
      </div>
    );
  }

  const resolveRowClass =
    typeof rowClassName === 'function' ? rowClassName : () => rowClassName;

  return (
    <>
      {renderBefore}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col, i) => (
              <TableHead key={i} className={cn(col.className, col.headerClassName)}>
                {col.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item, index) => (
            <Fragment key={rowKey(item)}>
              <TableRow className={resolveRowClass(item)}>
                {columns.map((col, ci) => (
                  <TableCell key={ci} className={col.className}>
                    {col.cell(item, index)}
                  </TableCell>
                ))}
              </TableRow>
              {renderAfterRow?.(item, index)}
            </Fragment>
          ))}
        </TableBody>
      </Table>
      {renderAfter}
    </>
  );
}

export function PageTableContent({
  isLoading,
  isError,
  errorMessage,
  countLabel,
  skeletonRows = 3,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  errorMessage: ReactNode;
  countLabel?: ReactNode;
  skeletonRows?: number;
  children: ReactNode;
}): ReactNode {
  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: skeletonRows }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-body3 text-error">{errorMessage}</p>;
  }

  return (
    <>
      {children}
      {countLabel != null && (
        <div className="mt-3 flex items-center justify-between text-body3 text-foreground-tertiary">
          <span>{countLabel}</span>
        </div>
      )}
    </>
  );
}

export function TableToolbar({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5">
      {children}
      {actions != null && (
        <>
          <div className="flex-1" />
          {actions}
        </>
      )}
    </div>
  );
}

export function SearchInput({
  placeholder,
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  'aria-label'?: string;
}): ReactNode {
  return (
    <div className="relative min-w-[260px]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
      <Input
        inputSize="sm"
        className="pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
