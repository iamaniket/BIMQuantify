'use client';

import { Search } from '@bimstitch/ui/icons';
import { Fragment, type ReactNode } from 'react';

import {
  cn,
  Input,
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
  /** When set, the column header is clickable and sorts by this server key
   * (or `sortAccessors` key for client-paginated tables). Used by `DataTable`. */
  sortKey?: string;
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
      <div className="overflow-x-auto">
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
      </div>
      {renderAfter}
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
    <div className="relative min-w-0 w-full sm:w-auto sm:min-w-[260px]">
      <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-placeholder" />
      <Input
        inputSize="md"
        className="pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        aria-label={ariaLabel}
      />
    </div>
  );
}
