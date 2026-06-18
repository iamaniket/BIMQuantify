import {
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';

import { ArrowDown, ArrowUp, FlipVertical } from './lib/iconMap.js';
import { cn } from './lib/cn.js';

const TABLE_HEAD_CLASS =
  'px-3 py-2 text-left text-caption font-bold uppercase tracking-wider text-foreground-tertiary';

export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...rest }, ref) => (
    <table
      ref={ref}
      className={cn('w-full border-collapse text-body3', className)}
      {...rest}
    />
  ),
);
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...rest} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...rest} />
));
TableBody.displayName = 'TableBody';

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...rest }, ref) => (
    <tr
      ref={ref}
      className={cn('border-b border-border transition-colors', className)}
      {...rest}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...rest }, ref) => (
    <th ref={ref} className={cn(TABLE_HEAD_CLASS, className)} {...rest} />
  ),
);
TableHead.displayName = 'TableHead';

export type SortDirection = 'asc' | 'desc';

export type SortableTableHeadProps = Omit<
  ThHTMLAttributes<HTMLTableCellElement>,
  'onClick' | 'children'
> & {
  children: ReactNode;
  /** When false this renders a plain, non-interactive header cell. */
  sortable?: boolean;
  /** This column is the active sort key. */
  active?: boolean;
  /** Direction of the active sort (only meaningful when `active`). */
  direction?: SortDirection;
  /** Fired on click / Enter / Space — the consumer flips key + direction. */
  onSort?: () => void;
};

/**
 * A header cell that toggles sorting. The whole label is a button; an arrow
 * glyph shows asc/desc when active and a faint neutral ⇅ when sortable but
 * inactive. `aria-sort` is set so assistive tech announces the state.
 */
export const SortableTableHead = forwardRef<HTMLTableCellElement, SortableTableHeadProps>(
  ({ className, children, sortable = true, active = false, direction = 'asc', onSort, ...rest }, ref) => {
    if (!sortable) {
      return (
        <th ref={ref} className={cn(TABLE_HEAD_CLASS, className)} {...rest}>
          {children}
        </th>
      );
    }
    const Glyph = active ? (direction === 'asc' ? ArrowUp : ArrowDown) : FlipVertical;
    return (
      <th
        ref={ref}
        aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(TABLE_HEAD_CLASS, className)}
        {...rest}
      >
        <button
          type="button"
          onClick={onSort}
          className={cn(
            'group -mx-1 inline-flex cursor-pointer items-center gap-1 rounded px-1 py-0.5',
            'uppercase tracking-wider transition-colors hover:text-foreground-secondary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            active && 'text-foreground-secondary',
          )}
        >
          {children}
          <Glyph
            weight="bold"
            className={cn(
              'h-3 w-3 shrink-0 transition-opacity',
              active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70',
            )}
            aria-hidden
          />
        </button>
      </th>
    );
  },
);
SortableTableHead.displayName = 'SortableTableHead';

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...rest }, ref) => (
    <td
      ref={ref}
      className={cn('px-3 py-2.5', className)}
      {...rest}
    />
  ),
);
TableCell.displayName = 'TableCell';
