import { forwardRef, type HTMLAttributes } from 'react';

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from './lib/iconMap.js';
import { cn } from './lib/cn.js';
import { IconButton } from './IconButton.js';
import { Select } from './Select.js';

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/**
 * Build the windowed list of page numbers to render, with `'dots'` markers
 * standing in for the elided ranges. Always shows the first and last page plus
 * `siblings` neighbours on each side of `current`.
 *
 * Pure + exported so it can be unit-tested independently of the component.
 */
export function paginationRange(
  current: number,
  pageCount: number,
  siblings = 1,
): (number | 'dots')[] {
  const span = (start: number, end: number): number[] =>
    Array.from({ length: Math.max(end - start + 1, 0) }, (_, i) => start + i);

  // first + last + current + 2*siblings + 2 dot slots
  const totalSlots = siblings * 2 + 5;
  if (pageCount <= totalSlots) return span(1, pageCount);

  const leftSibling = Math.max(current - siblings, 1);
  const rightSibling = Math.min(current + siblings, pageCount);
  const showLeftDots = leftSibling > 2;
  const showRightDots = rightSibling < pageCount - 1;

  if (!showLeftDots && showRightDots) {
    return [...span(1, 3 + 2 * siblings), 'dots', pageCount];
  }
  if (showLeftDots && !showRightDots) {
    return [1, 'dots', ...span(pageCount - (3 + 2 * siblings) + 1, pageCount)];
  }
  return [1, 'dots', ...span(leftSibling, rightSibling), 'dots', pageCount];
}

export type PaginationLabels = {
  /** "Rows per page" */
  rowsPerPage: string;
  /** Pre-formatted range, e.g. "Showing 26–50 of 213". */
  range: string;
  first: string;
  previous: string;
  next: string;
  last: string;
};

export type PaginationProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  /** 1-based current page. */
  page: number;
  /** Total number of pages (clamped to >= 1 by the caller). */
  pageCount: number;
  pageSize: number;
  pageSizeOptions?: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  /** Disables every control (e.g. while a page is loading). */
  disabled?: boolean;
  /** Hide the numbered page buttons, leaving only first/prev/next/last. */
  showPageNumbers?: boolean;
  labels: PaginationLabels;
  /** aria-label for a numbered page button. Defaults to the page number. */
  pageAriaLabel?: (page: number) => string;
};

const PAGE_BUTTON_BASE =
  'inline-grid h-7 min-w-7 cursor-pointer place-items-center rounded px-1.5 font-sans '
  + 'text-body3 tabular-nums transition-colors '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring '
  + 'disabled:cursor-not-allowed';

export const Pagination = forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      page,
      pageCount,
      pageSize,
      pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
      onPageChange,
      onPageSizeChange,
      disabled = false,
      showPageNumbers = true,
      labels,
      pageAriaLabel = (n) => String(n),
      className,
      ...rest
    },
    ref,
  ) => {
    const safePageCount = Math.max(pageCount, 1);
    const atStart = page <= 1;
    const atEnd = page >= safePageCount;
    const numbers = showPageNumbers ? paginationRange(page, safePageCount) : [];

    const go = (target: number): void => {
      const clamped = Math.min(Math.max(target, 1), safePageCount);
      if (clamped !== page) onPageChange(clamped);
    };

    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-4 gap-y-2',
          'font-sans text-body3 text-foreground-tertiary',
          className,
        )}
        {...rest}
      >
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap">{labels.rowsPerPage}</span>
          <Select
            selectSize="sm"
            className="w-auto pr-8"
            value={String(pageSize)}
            disabled={disabled}
            onChange={(e) => { onPageSizeChange(Number(e.target.value)); }}
            aria-label={labels.rowsPerPage}
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </Select>
          <span className="ml-1 whitespace-nowrap tabular-nums">{labels.range}</span>
        </div>

        <div className="flex items-center gap-0.5">
          <IconButton
            size="sm"
            icon={ChevronsLeft}
            aria-label={labels.first}
            disabled={disabled || atStart}
            onClick={() => { go(1); }}
          />
          <IconButton
            size="sm"
            icon={ChevronLeft}
            aria-label={labels.previous}
            disabled={disabled || atStart}
            onClick={() => { go(page - 1); }}
          />

          {numbers.map((item, i) =>
            item === 'dots' ? (
              <span
                key={`dots-${i}`}
                aria-hidden
                className="inline-grid h-7 min-w-7 place-items-center text-foreground-placeholder"
              >
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={pageAriaLabel(item)}
                aria-current={item === page ? 'page' : undefined}
                disabled={disabled}
                onClick={() => { go(item); }}
                className={cn(
                  PAGE_BUTTON_BASE,
                  item === page
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground-secondary hover:bg-background-hover',
                )}
              >
                {item}
              </button>
            ),
          )}

          <IconButton
            size="sm"
            icon={ChevronRight}
            aria-label={labels.next}
            disabled={disabled || atEnd}
            onClick={() => { go(page + 1); }}
          />
          <IconButton
            size="sm"
            icon={ChevronsRight}
            aria-label={labels.last}
            disabled={disabled || atEnd}
            onClick={() => { go(safePageCount); }}
          />
        </div>
      </div>
    );
  },
);

Pagination.displayName = 'Pagination';
