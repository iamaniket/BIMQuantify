'use client';

import {
  useEffect, useRef, useState, type JSX, type ReactNode,
} from 'react';

import { CalendarDayCell } from './CalendarDayCell';
import { buildMonthMatrix, weekdayHeaders } from './monthGrid';

type Props<T> = {
  viewDate: Date;
  today: Date;
  locale: string;
  itemsByDay: Map<string, T[]>;
  getItemId: (item: T) => string;
  renderChip: (item: T) => ReactNode;
  selectedDay: string | null;
  onSelectDay: (iso: string) => void;
  moreLabel: (count: number) => string;
  /** Fallback chip cap shown before the grid is measured. */
  maxChipsPerCell?: number;
  /** Merged onto the root — pass `flex-1 min-h-0` to fill available height. */
  className?: string;
  /** iso → localized holiday name; tints the day and labels it. */
  holidaysByDay?: Map<string, string>;
  /** iso days carrying an overdue item; adds the red accent. */
  overdueDays?: Set<string>;
  /**
   * Optional per-day wrapper — lets a feature make each day a drop target
   * without pulling a DnD dependency into this store-agnostic component.
   */
  wrapDay?: (iso: string, cell: ReactNode) => ReactNode;
};

// Heuristic cell geometry (px) for fitting chips to the measured row height.
// CHIP_HEIGHT tracks CalendarEventChip's 22px height plus the 2px stack gap.
const DAY_NUMBER_BAND = 20;
const CHIP_HEIGHT = 24;
const CELL_VPAD = 6;
const MAX_CHIPS = 10;

/**
 * Pure, store-agnostic month grid: a weekday header over a Monday-first 6×7
 * matrix that stretches to fill its container. Items are supplied pre-grouped
 * by day key; the caller decides how a chip looks (`renderChip`) and what
 * selecting a day does (`onSelectDay`). The visible chips-per-cell adapt to the
 * measured row height so taller layouts show more before "+N more".
 */
export function MonthCalendar<T>({
  viewDate,
  today,
  locale,
  itemsByDay,
  getItemId,
  renderChip,
  selectedDay,
  onSelectDay,
  moreLabel,
  maxChipsPerCell = 3,
  className,
  holidaysByDay,
  overdueDays,
  wrapDay,
}: Props<T>): JSX.Element {
  const weeks = buildMonthMatrix(viewDate, today);
  const headers = weekdayHeaders(locale);

  const gridRef = useRef<HTMLDivElement>(null);
  const [maxChips, setMaxChips] = useState(maxChipsPerCell);

  useEffect(() => {
    const el = gridRef.current;
    if (el === null) return undefined;

    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const compute = (): boolean => {
      const h = el.getBoundingClientRect().height;
      if (h <= 0) return false;
      const rowHeight = h / weeks.length;
      const fit = Math.floor((rowHeight - DAY_NUMBER_BAND - CELL_VPAD) / CHIP_HEIGHT);
      setMaxChips(Math.max(1, Math.min(fit, MAX_CHIPS)));
      return true;
    };
    // setTimeout (not requestAnimationFrame) so this also resolves in headless
    // render targets where rAF is throttled and never fires.
    const tryMeasure = (): void => {
      if (!compute() && attempts < 100) {
        attempts += 1;
        timer = setTimeout(tryMeasure, 50);
      }
    };
    tryMeasure();

    // ResizeObserver is absent in some headless/test environments — the
    // setTimeout poll above still seeds a sensible value there.
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => { compute(); });
      observer.observe(el);
    }
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      observer?.disconnect();
    };
  }, [weeks.length]);

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-border ${className ?? ''}`}>
      <div className="grid shrink-0 grid-cols-7 border-b border-border bg-surface-low">
        {headers.map((label, i) => (
          <div
            key={i}
            className="px-1.5 py-1 text-center text-caption font-semibold uppercase tracking-wide text-foreground-tertiary"
          >
            {label}
          </div>
        ))}
      </div>
      <div
        ref={gridRef}
        className="grid min-h-0 flex-1 grid-cols-7 gap-px bg-border"
        style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))` }}
      >
        {weeks.flat().map((cell) => {
          const node = (
            <CalendarDayCell<T>
              cell={cell}
              items={itemsByDay.get(cell.iso) ?? []}
              getItemId={getItemId}
              renderChip={renderChip}
              maxChips={maxChips}
              selected={selectedDay === cell.iso}
              onSelect={onSelectDay}
              moreLabel={moreLabel}
              holidayName={holidaysByDay?.get(cell.iso) ?? null}
              isOverdue={overdueDays?.has(cell.iso) ?? false}
            />
          );
          return (
            <div key={cell.iso} className="min-h-0">
              {wrapDay ? wrapDay(cell.iso, node) : node}
            </div>
          );
        })}
      </div>
    </div>
  );
}
