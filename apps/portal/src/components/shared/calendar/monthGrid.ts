/**
 * Month-grid date math for the calendar primitives.
 *
 * Native `Date` only — the portal ships no date library. Every grid key is a
 * *local* `YYYY-MM-DD` string and date values are bucketed by their literal
 * date portion, so date-only values land on the right cell without timezone
 * drift (research note §4 — handle timezones explicitly to avoid off-by-one).
 */

export type DayCell = {
  date: Date;
  /** Local `YYYY-MM-DD` key — used to look events up and as a React key. */
  iso: string;
  dayOfMonth: number;
  /** True when the cell belongs to the viewed month (vs. spill-over days). */
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
};

/** Local `YYYY-MM-DD` for a Date (no UTC conversion). */
export function isoDay(date: Date): string {
  const y = String(date.getFullYear());
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** First day of `date`'s month at local midnight. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** `date`'s month shifted by `delta` months, anchored to the 1st. */
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

/** `date` shifted by `delta` years, anchored to the 1st of the same month. */
export function addYears(date: Date, delta: number): Date {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1);
}

/** `date` shifted by `delta` whole days, at local midnight. */
export function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

/** `date` shifted by `delta` weeks (7-day steps). */
export function addWeeks(date: Date, delta: number): Date {
  return addDays(date, delta * 7);
}

/** Monday of the week containing `date`, at local midnight. */
export function startOfWeek(date: Date): Date {
  const mondayOffset = (date.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  return addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -mondayOffset);
}

/** True when both dates fall in the same calendar month + year. */
export function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** True when both dates fall on the same calendar day. */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  );
}

/** True when both dates fall in the same Monday-first week. */
export function isSameWeek(a: Date, b: Date): boolean {
  return isSameDay(startOfWeek(a), startOfWeek(b));
}

/**
 * Stable grid key from a date or datetime string. Takes the leading
 * `YYYY-MM-DD` verbatim when present (timezone-safe for date-only values);
 * otherwise parses and formats in local time. Returns null for empty/invalid.
 */
export function toDayKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const direct = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  if (direct?.[1] !== undefined) return direct[1];
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return isoDay(parsed);
}

/** Reconstruct a local Date from a `YYYY-MM-DD` key, or null if malformed. */
export function parseDayKey(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m?.[1] === undefined || m[2] === undefined || m[3] === undefined) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Monday-first month matrix covering `viewDate`'s month plus the spill-over
 * days that fill the first and last weeks. Renders only the weeks the month
 * actually spans (4–6 rows) — no trailing all-spill-over week — so the grid
 * stays compact like Google Calendar. `today` drives the `isToday` flag
 * (injected, not read from the clock, so the grid is deterministic in tests).
 */
export function buildMonthMatrix(viewDate: Date, today: Date): DayCell[][] {
  const first = startOfMonth(viewDate);
  const mondayOffset = (first.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  const month = viewDate.getMonth();
  const daysInMonth = new Date(first.getFullYear(), month + 1, 0).getDate();
  // Weeks needed to cover the leading offset + every day of the month.
  const weeksNeeded = Math.ceil((mondayOffset + daysInMonth) / 7);
  const todayKey = isoDay(today);

  const weeks: DayCell[][] = [];
  for (let w = 0; w < weeksNeeded; w += 1) {
    const row: DayCell[] = [];
    for (let d = 0; d < 7; d += 1) {
      const offset = w * 7 + d - mondayOffset;
      const date = new Date(first.getFullYear(), first.getMonth(), 1 + offset);
      const iso = isoDay(date);
      row.push({
        date,
        iso,
        dayOfMonth: date.getDate(),
        inMonth: date.getMonth() === month,
        isToday: iso === todayKey,
        isWeekend: d >= 5,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

/**
 * Monday-first array of the 7 day cells for the week containing `viewDate`.
 * `inMonth` is relative to `viewDate`'s month so a week straddling a month
 * boundary lightly mutes the spill-over days, matching the month grid.
 */
export function buildWeekDays(viewDate: Date, today: Date): DayCell[] {
  const monday = startOfWeek(viewDate);
  const month = viewDate.getMonth();
  const todayKey = isoDay(today);
  return Array.from({ length: 7 }, (_, d) => {
    const date = addDays(monday, d);
    const iso = isoDay(date);
    return {
      date,
      iso,
      dayOfMonth: date.getDate(),
      inMonth: date.getMonth() === month,
      isToday: iso === todayKey,
      isWeekend: d >= 5,
    };
  });
}

/** Localized `June 2026` header. */
export function monthLabel(viewDate: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(viewDate);
}

/** Localized week-range header for the toolbar, e.g. `9 – 15 Jun 2026`. */
export function weekRangeLabel(viewDate: Date, locale: string): string {
  const monday = startOfWeek(viewDate);
  const sunday = addDays(monday, 6);
  const fmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  // `formatRange` collapses shared parts (e.g. `9 – 15 Jun 2026`) when available.
  if (typeof fmt.formatRange === 'function') return fmt.formatRange(monday, sunday);
  return `${fmt.format(monday)} – ${fmt.format(sunday)}`;
}

/** Localized Monday-first short weekday names (`Mon`…`Sun`). */
export function weekdayHeaders(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2024-01-01 is a Monday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
}

/** Localized short weekday for a single date, e.g. `Tue`. */
export function weekdayShort(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
}

/** Localized day heading for the side panel, e.g. `Tue, Jun 16`. */
export function dayHeading(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}

/** Localized full day heading for the day view, e.g. `Tuesday, 16 June 2026`. */
export function fullDayHeading(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
}
