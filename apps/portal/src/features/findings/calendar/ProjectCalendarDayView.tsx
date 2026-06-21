'use client';

import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { fullDayHeading } from '@/components/shared/calendar/monthGrid';
import type { Locale } from '@bimstitch/i18n';

import { type CalendarEvent } from './calendarEvents';
import { DroppableDay } from './dnd/calendarDnd';

type Props = {
  t: ReturnType<typeof useTranslations>;
  locale: Locale;
  viewDate: Date;
  dayKey: string;
  dayViewEvents: CalendarEvent[];
  dayHoliday: string | null;
  renderRow: (event: CalendarEvent) => ReactNode;
};

export function ProjectCalendarDayView({
  t,
  locale,
  viewDate,
  dayKey,
  dayViewEvents,
  dayHoliday,
  renderRow,
}: Props): JSX.Element {
  return (
    <DroppableDay iso={dayKey}>
      <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-gradient-to-r from-primary-light to-primary-lighter px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-body1 font-semibold capitalize text-foreground">
              {fullDayHeading(viewDate, locale)}
            </span>
            <span className="text-caption text-foreground-tertiary">
              {t('dayPanel.count', { count: dayViewEvents.length })}
            </span>
          </div>
          {dayHoliday !== null && (
            <span className="shrink-0 rounded-md bg-info-light px-2 py-0.5 text-caption font-medium text-info">
              {dayHoliday}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {dayViewEvents.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-10 text-center text-body3 text-foreground-tertiary">
              {t('dayEmpty')}
            </p>
          ) : (
            <ul className="mx-auto flex max-w-2xl flex-col gap-2">
              {dayViewEvents.map((event) => (
                <li key={event.id}>{renderRow(event)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </DroppableDay>
  );
}
