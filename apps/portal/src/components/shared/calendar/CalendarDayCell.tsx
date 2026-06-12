import type { JSX, KeyboardEvent, ReactNode } from 'react';

import type { DayCell } from './monthGrid';

type Props<T> = {
  cell: DayCell;
  items: T[];
  getItemId: (item: T) => string;
  renderChip: (item: T) => ReactNode;
  maxChips: number;
  selected: boolean;
  onSelect: (iso: string) => void;
  moreLabel: (count: number) => string;
  /** Localized holiday name when this day is a public holiday, else null. */
  holidayName?: string | null;
  /** True when the day carries an overdue item (red accent). */
  isOverdue?: boolean;
};

/** Day-number colour: highlighted today, lightly muted for spill-over days. */
function numberToneClass(cell: DayCell): string {
  if (cell.isToday) return 'grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground';
  if (cell.inMonth) return 'text-foreground-secondary';
  return 'text-foreground-tertiary';
}

/**
 * Cell background. Holiday wins over weekend. Spill-over (adjacent-month) days
 * are styled the same as in-month days — they're fully usable (Google-style),
 * distinguished only by a lighter day number. Tokens only — no raw colour.
 */
function cellBackground(cell: DayCell, isHoliday: boolean): string {
  if (isHoliday) return 'bg-info-lighter/40';
  if (cell.isWeekend) return 'bg-surface-low';
  return 'bg-background';
}

/**
 * One day in the month grid. Days that carry items are a clickable element (the
 * whole cell selects the day → opens the side panel); chips inside are supplied
 * by the caller and may themselves be draggable, so the cell is a `div`
 * (`role="button"`) rather than a `<button>` to keep nested interactives valid.
 * Empty days are inert. The cell grows to fill its grid row (`h-full`).
 */
export function CalendarDayCell<T>({
  cell,
  items,
  getItemId,
  renderChip,
  maxChips,
  selected,
  onSelect,
  moreLabel,
  holidayName = null,
  isOverdue = false,
}: Props<T>): JSX.Element {
  const shown = items.slice(0, maxChips);
  const extra = items.length - shown.length;
  const isHoliday = holidayName !== null;

  const base = `flex h-full min-h-[92px] flex-col gap-1 overflow-hidden p-1.5 ${cellBackground(
    cell,
    isHoliday,
  )} ${selected ? 'ring-2 ring-inset ring-primary' : ''}`;

  const header = (
    <div className="flex items-start justify-between gap-1">
      {isHoliday ? (
        <span
          title={holidayName}
          className="min-w-0 truncate text-caption font-medium text-info"
        >
          {holidayName}
        </span>
      ) : (
        <span className="min-w-0" />
      )}
      <span className="flex shrink-0 items-center gap-1">
        {isOverdue && <span className="h-1.5 w-1.5 rounded-full bg-error" aria-hidden />}
        <span className={`text-caption font-semibold tabular-nums ${numberToneClass(cell)}`}>
          {cell.dayOfMonth}
        </span>
      </span>
    </div>
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(cell.iso);
    }
  };

  // Every day is selectable — including spill-over days from adjacent months
  // (Google-style), so any date can be opened or used as a drop target.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { onSelect(cell.iso); }}
      onKeyDown={handleKeyDown}
      className={`${base} cursor-pointer text-left transition-colors hover:bg-background-hover`}
    >
      {header}
      {items.length > 0 && (
        <div className="flex min-h-0 flex-col gap-0.5">
          {shown.map((item) => (
            <div key={getItemId(item)}>{renderChip(item)}</div>
          ))}
          {extra > 0 && (
            <span className="px-1 text-caption font-medium text-foreground-tertiary">{moreLabel(extra)}</span>
          )}
        </div>
      )}
    </div>
  );
}
