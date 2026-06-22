'use client';

import { X } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { IconButton } from '@bimstitch/ui';

import { dayHeading } from '@/components/shared/calendar/monthGrid';
import type { Locale } from '@bimstitch/i18n';

import { type CalendarEvent } from './calendarEvents';

type Props = {
  t: ReturnType<typeof useTranslations>;
  locale: Locale;
  selectedDate: Date;
  dayEvents: CalendarEvent[];
  onClose: () => void;
  renderRow: (event: CalendarEvent) => ReactNode;
};

export function ProjectCalendarDayPanel({
  t,
  locale,
  selectedDate,
  dayEvents,
  onClose,
  renderRow,
}: Props): JSX.Element {
  return (
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
        <IconButton icon={X} aria-label={t('dayPanel.close')} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {dayEvents.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body3 text-foreground-tertiary">
            {t('dayEmpty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {dayEvents.map((event) => (
              <li key={event.id}>{renderRow(event)}</li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
