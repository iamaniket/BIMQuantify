import { describe, expect, it } from 'vitest';

import {
  addMonths,
  addYears,
  buildMonthMatrix,
  isoDay,
  isSameMonth,
  parseDayKey,
  startOfMonth,
  toDayKey,
  weekdayHeaders,
} from './monthGrid';

// June 2026: the 1st is a Monday. July 2026: the 1st is a Wednesday.
const JUNE = new Date(2026, 5, 1);
const JULY = new Date(2026, 6, 1);

describe('monthGrid', () => {
  it('renders only the weeks the month spans (dynamic rows, 7 cols)', () => {
    // Jun 2026: Mon start, 30 days → exactly 5 weeks (no trailing empty row).
    const june = buildMonthMatrix(JUNE, new Date(2026, 5, 12));
    expect(june).toHaveLength(5);
    for (const week of june) expect(week).toHaveLength(7);
    // Aug 2026: Sat start, 31 days → needs 6 weeks.
    expect(buildMonthMatrix(new Date(2026, 7, 1), JUNE)).toHaveLength(6);
    // Feb 2027: Mon start, 28 days → fits in 4 weeks.
    expect(buildMonthMatrix(new Date(2027, 1, 1), JUNE)).toHaveLength(4);
  });

  it('is Monday-first — June 2026 starts exactly on the 1st', () => {
    const weeks = buildMonthMatrix(JUNE, new Date(2026, 5, 12));
    expect(weeks[0]?.[0]?.iso).toBe('2026-06-01');
    expect(weeks[0]?.[0]?.inMonth).toBe(true);
  });

  it('fills spill-over days and flags them out-of-month', () => {
    // July 1 is a Wednesday → the grid leads with Mon Jun 29 + Tue Jun 30.
    const weeks = buildMonthMatrix(JULY, JULY);
    expect(weeks[0]?.[0]?.iso).toBe('2026-06-29');
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
    expect(weeks[0]?.[2]?.iso).toBe('2026-07-01');
    expect(weeks[0]?.[2]?.inMonth).toBe(true);
  });

  it('flags exactly one cell as today', () => {
    const today = new Date(2026, 5, 12);
    const todays = buildMonthMatrix(JUNE, today).flat().filter((c) => c.isToday);
    expect(todays).toHaveLength(1);
    expect(todays[0]?.iso).toBe('2026-06-12');
  });

  it('addMonths crosses the year boundary', () => {
    expect(isoDay(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-01');
    expect(isoDay(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-01');
  });

  it('addYears shifts the year and anchors to the 1st', () => {
    expect(isoDay(addYears(new Date(2026, 5, 23), 1))).toBe('2027-06-01');
    expect(isoDay(addYears(new Date(2026, 5, 23), -1))).toBe('2025-06-01');
  });

  it('isSameMonth compares month + year', () => {
    expect(isSameMonth(new Date(2026, 5, 1), new Date(2026, 5, 30))).toBe(true);
    expect(isSameMonth(new Date(2026, 5, 1), new Date(2026, 6, 1))).toBe(false);
    expect(isSameMonth(new Date(2026, 5, 1), new Date(2027, 5, 1))).toBe(false);
  });

  it('flags Saturday + Sunday as weekend', () => {
    // June 2026 starts Monday → first row is Mon..Sun (Jun 1..7).
    const week = buildMonthMatrix(JUNE, JUNE)[0];
    expect(week?.[0]?.isWeekend).toBe(false); // Mon
    expect(week?.[4]?.isWeekend).toBe(false); // Fri
    expect(week?.[5]?.isWeekend).toBe(true); // Sat
    expect(week?.[6]?.isWeekend).toBe(true); // Sun
  });

  it('toDayKey takes the date portion verbatim (timezone-safe)', () => {
    expect(toDayKey('2026-06-12')).toBe('2026-06-12');
    expect(toDayKey('2026-06-12T23:30:00Z')).toBe('2026-06-12');
    expect(toDayKey(null)).toBeNull();
    expect(toDayKey('')).toBeNull();
    expect(toDayKey('not-a-date')).toBeNull();
  });

  it('parseDayKey round-trips and rejects garbage', () => {
    const d = parseDayKey('2026-06-12');
    expect(d).not.toBeNull();
    if (d !== null) expect(isoDay(d)).toBe('2026-06-12');
    expect(parseDayKey('garbage')).toBeNull();
  });

  it('weekdayHeaders is Monday-first', () => {
    const headers = weekdayHeaders('en-US');
    expect(headers).toHaveLength(7);
    expect(headers[0]).toBe('Mon');
    expect(headers[6]).toBe('Sun');
  });

  it('startOfMonth anchors to the 1st', () => {
    expect(isoDay(startOfMonth(new Date(2026, 5, 23)))).toBe('2026-06-01');
  });
});
