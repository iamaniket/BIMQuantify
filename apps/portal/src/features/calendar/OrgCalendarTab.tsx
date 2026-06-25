'use client';

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  X,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import {
  useMemo, useState, type JSX, type ReactNode,
} from 'react';

import { Button, IconButton, Skeleton } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { CalendarEventChip, TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';
import { MonthCalendar } from '@/components/shared/calendar/MonthCalendar';
import {
  addMonths,
  dayHeading,
  isSameMonth,
  monthLabel,
  parseDayKey,
  toDayKey,
} from '@/components/shared/calendar/monthGrid';
import { useHolidays } from '@/features/jurisdictions/useHolidays';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/formatting/dates';
import type { CalendarDeadline } from '@/lib/api/schemas/deadlines';

import { orgDeadlineTone } from './orgDeadlineTone';
import { useOrgDeadlines } from './useOrgDeadlines';

const LEGEND = [
  { tone: 'error', key: 'legend.overdue' },
  { tone: 'warning', key: 'legend.dueSoon' },
  { tone: 'info', key: 'legend.upcoming' },
  { tone: 'success', key: 'legend.met' },
] as const;

export function OrgCalendarTab(): JSX.Element {
  const t = useTranslations('calendar.month');
  const locale = useLocale() as Locale;
  const { data, isLoading } = useOrgDeadlines();

  const deadlines = useMemo(() => data ?? [], [data]);

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const [viewDate, setViewDate] = useState<Date>(today);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // The org is NL-first; holidays follow the jurisdiction of the deadlines.
  const country = deadlines[0]?.country ?? 'NL';
  const visibleYears = useMemo(() => {
    const year = viewDate.getFullYear();
    const years = new Set([year]);
    if (viewDate.getMonth() === 0) years.add(year - 1);
    if (viewDate.getMonth() === 11) years.add(year + 1);
    return Array.from(years);
  }, [viewDate]);
  const holidaysByDay = useHolidays(country, visibleYears);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarDeadline[]>();
    for (const dl of deadlines) {
      const iso = toDayKey(dl.due_date);
      if (iso === null) continue;
      const bucket = map.get(iso);
      if (bucket === undefined) map.set(iso, [dl]);
      else bucket.push(dl);
    }
    return map;
  }, [deadlines]);

  const overdueDays = useMemo(() => {
    const set = new Set<string>();
    for (const dl of deadlines) {
      const iso = toDayKey(dl.due_date);
      if (dl.is_overdue && iso !== null) set.add(iso);
    }
    return set;
  }, [deadlines]);

  const selectedDate = selectedDay === null ? null : parseDayKey(selectedDay);
  const dayEvents = selectedDay === null ? [] : itemsByDay.get(selectedDay) ?? [];

  const renderChip = (dl: CalendarDeadline): ReactNode => (
    <CalendarEventChip
      tone={orgDeadlineTone(dl)}
      icon={Clock}
      title={`${dl.label} · ${dl.project_name}`}
    />
  );

  const isCurrentMonth = isSameMonth(viewDate, today);

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-3 p-5">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="min-h-0 flex-1 w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: month navigation + legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          <IconButton size="md" icon={ChevronLeft} aria-label={t('prevMonth')} onClick={() => { setViewDate((d) => addMonths(d, -1)); }} />
          <span className="min-w-[150px] text-center text-body3 font-semibold capitalize text-foreground">
            {monthLabel(viewDate, locale)}
          </span>
          <IconButton size="md" icon={ChevronRight} aria-label={t('nextMonth')} onClick={() => { setViewDate((d) => addMonths(d, 1)); }} />
          <Button
            size="md"
            variant="border"
            className="ml-1"
            disabled={isCurrentMonth}
            onClick={() => { setViewDate(today); }}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t('today')}
          </Button>
        </div>

        <div className="hidden grid-cols-2 gap-x-3 gap-y-1.5 sm:grid lg:grid-cols-3">
          {LEGEND.map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary">
              <span className={`h-2 w-2 rounded-full ${TONE_STYLES[entry.tone].dot}`} />
              {t(entry.key)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary">
            <span className="h-2 w-2 rounded-full bg-info-lighter ring-1 ring-inset ring-info/40" />
            {t('legend.holiday')}
          </span>
        </div>
      </div>

      {/* Body: month grid + day side panel */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden p-5">
          {deadlines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center text-body3 text-foreground-tertiary">
              {t('empty')}
            </p>
          ) : (
            <MonthCalendar<CalendarDeadline>
              className="min-h-0 flex-1"
              viewDate={viewDate}
              today={today}
              locale={locale}
              itemsByDay={itemsByDay}
              getItemId={(dl) => dl.id}
              renderChip={renderChip}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              moreLabel={(count) => t('moreCount', { count })}
              holidaysByDay={holidaysByDay}
              overdueDays={overdueDays}
            />
          )}
        </div>

        {selectedDay !== null && selectedDate !== null && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-main">
            <div className="flex items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-primary-light to-primary-lighter px-4 py-3">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-body2 font-semibold capitalize text-foreground">
                  {dayHeading(selectedDate, locale)}
                </span>
                <span className="text-caption text-foreground-tertiary">
                  {t('dayPanel.count', { count: dayEvents.length })}
                </span>
              </div>
              <IconButton icon={X} aria-label={t('dayPanel.close')} onClick={() => { setSelectedDay(null); }} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {dayEvents.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body3 text-foreground-tertiary">
                  {t('dayEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {dayEvents.map((dl) => {
                    const tone = orgDeadlineTone(dl);
                    return (
                      <li key={dl.id}>
                        <Link
                          href={`/projects/${dl.project_id}`}
                          className="group/row relative flex w-full items-start gap-2 overflow-hidden rounded-lg border border-border bg-background py-2 pl-3 pr-2.5 text-left transition-all hover:bg-background-hover hover:shadow-sm"
                        >
                          <span className={`absolute inset-y-0 left-0 w-1 ${TONE_STYLES[tone].dot}`} aria-hidden />
                          <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${TONE_STYLES[tone].chip}`}>
                            <Clock className="h-4 w-4" aria-hidden />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-body3 font-semibold text-foreground">{dl.label}</span>
                            <span className="truncate text-caption text-foreground-tertiary">
                              {dl.project_name}
                              {dl.due_date !== null ? ` · ${formatDate(dl.due_date, locale)}` : ''}
                            </span>
                          </span>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
