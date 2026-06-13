'use client';

import type { JSX, ReactNode } from 'react';

import type { DayCell } from './monthGrid';
import { weekdayShort } from './monthGrid';

type Props<T> = {
  /** The 7 Monday-first day cells of the viewed week. */
  days: DayCell[];
  locale: string;
  itemsByDay: Map<string, T[]>;
  getItemId: (item: T) => string;
  /** Full-size row renderer (the same draggable rows the day panel uses). */
  renderItem: (item: T) => ReactNode;
  selectedDay: string | null;
  onSelectDay: (iso: string) => void;
  /** Merged onto the root — pass `flex-1 min-h-0` to fill available height. */
  className?: string;
  /** iso → localized holiday name; tints the column and labels it. */
  holidaysByDay?: Map<string, string>;
  /** iso days carrying an overdue item; adds the red accent dot. */
  overdueDays?: Set<string>;
  /** Optional per-day wrapper so a column can become a DnD drop target. */
  wrapDay?: (iso: string, column: ReactNode) => ReactNode;
};

/** Header day-number style — today gets the primary gradient pill. */
function headerNumberClass(cell: DayCell): string {
  if (cell.isToday) {
    return 'grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-primary to-primary-hover text-body2 font-semibold text-primary-foreground shadow-sm';
  }
  return `grid h-7 w-7 place-items-center text-body2 font-semibold tabular-nums ${
    cell.inMonth ? 'text-foreground' : 'text-foreground-tertiary'
  }`;
}

/** Column background. Holiday wins over weekend; tokens only. */
function columnBackground(cell: DayCell, isHoliday: boolean): string {
  if (isHoliday) return 'bg-info-lighter/30';
  if (cell.isWeekend) return 'bg-surface-low';
  return 'bg-background';
}

/**
 * Pure, store-agnostic week view: 7 equal columns, each a stacked agenda of
 * full-size event rows that scroll independently. Mirrors {@link MonthCalendar}
 * (same item bucketing, holiday/overdue/selection treatment, `wrapDay` DnD
 * seam) but trades the chip grid for roomy rows — easier to read and to drag.
 */
export function WeekCalendar<T>({
  days,
  locale,
  itemsByDay,
  getItemId,
  renderItem,
  selectedDay,
  onSelectDay,
  className,
  holidaysByDay,
  overdueDays,
  wrapDay,
}: Props<T>): JSX.Element {
  return (
    <div className={`flex min-h-0 overflow-hidden rounded-lg border border-border ${className ?? ''}`}>
      {days.map((cell) => {
        const items = itemsByDay.get(cell.iso) ?? [];
        const holidayName = holidaysByDay?.get(cell.iso) ?? null;
        const isHoliday = holidayName !== null;
        const isOverdue = overdueDays?.has(cell.iso) ?? false;
        const selected = selectedDay === cell.iso;

        const column = (
          <div
            className={`flex h-full flex-col border-l border-border first:border-l-0 ${columnBackground(
              cell,
              isHoliday,
            )} ${selected ? 'ring-2 ring-inset ring-primary' : ''}`}
          >
            <button
              type="button"
              onClick={() => { onSelectDay(cell.iso); }}
              className="flex shrink-0 flex-col items-center gap-0.5 border-b border-border px-1 py-2 transition-colors hover:bg-background-hover"
            >
              <span className="text-caption font-semibold uppercase tracking-wide text-foreground-tertiary">
                {weekdayShort(cell.date, locale)}
              </span>
              <span className="flex items-center gap-1">
                {isOverdue && <span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden />}
                <span className={headerNumberClass(cell)}>{cell.dayOfMonth}</span>
              </span>
              {isHoliday && (
                <span title={holidayName} className="w-full truncate text-center text-micro font-medium text-info">
                  {holidayName}
                </span>
              )}
            </button>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
              {items.map((item) => (
                <div key={getItemId(item)}>{renderItem(item)}</div>
              ))}
            </div>
          </div>
        );

        return (
          <div key={cell.iso} className="min-w-0 flex-1">
            {wrapDay ? wrapDay(cell.iso, column) : column}
          </div>
        );
      })}
    </div>
  );
}
