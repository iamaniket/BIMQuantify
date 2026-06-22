'use client';

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button, CountChip, IconButton } from '@bimstitch/ui';

import { TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';

import {
  KIND_ICON,
  type CalendarEventKind,
} from './calendarEvents';
import {
  KINDS,
  LEGEND,
  VIEWS,
  type CalendarView,
} from './calendarViews';

type Props = {
  t: ReturnType<typeof useTranslations>;
  view: CalendarView;
  changeView: (next: CalendarView) => void;
  navLabels: { single: [string, string]; big: [string, string] };
  stepBy: (dir: -1 | 1, big: boolean) => void;
  periodLabel: string;
  isCurrentPeriod: boolean;
  onToday: () => void;
  kindFilters: Record<CalendarEventKind, boolean>;
  kindCounts: Record<CalendarEventKind, number>;
  toggleKind: (kind: CalendarEventKind) => void;
};

export function ProjectCalendarToolbar({
  t,
  view,
  changeView,
  navLabels,
  stepBy,
  periodLabel,
  isCurrentPeriod,
  onToday,
  kindFilters,
  kindCounts,
  toggleKind,
}: Props): JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Month / Week / Day switcher */}
        <div className="inline-flex items-center rounded-md border border-border bg-surface-low p-0.5">
          {VIEWS.map(({ value, icon: Icon }) => {
            const active = view === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => { changeView(value); }}
                aria-pressed={active}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-body3 font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-br from-primary to-primary-hover text-primary-foreground shadow-sm'
                    : 'text-foreground-secondary hover:bg-background-hover'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(`views.${value}`)}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1">
          <IconButton size="md" icon={ChevronsLeft} aria-label={t(navLabels.big[0])} onClick={() => { stepBy(-1, true); }} />
          <IconButton size="md" icon={ChevronLeft} aria-label={t(navLabels.single[0])} onClick={() => { stepBy(-1, false); }} />
          <span className="min-w-[150px] text-center text-body3 font-semibold capitalize text-foreground">
            {periodLabel}
          </span>
          <IconButton size="md" icon={ChevronRight} aria-label={t(navLabels.single[1])} onClick={() => { stepBy(1, false); }} />
          <IconButton size="md" icon={ChevronsRight} aria-label={t(navLabels.big[1])} onClick={() => { stepBy(1, true); }} />
          <Button
            size="md"
            variant="border"
            className="ml-1"
            disabled={isCurrentPeriod}
            onClick={onToday}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t('today')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          {KINDS.map((kind) => {
            const Icon = KIND_ICON[kind];
            const active = kindFilters[kind];
            return (
              <button
                key={kind}
                type="button"
                onClick={() => { toggleKind(kind); }}
                aria-pressed={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-body3 font-medium transition-colors ${
                  active
                    ? 'border-border bg-surface-low text-foreground-secondary'
                    : 'border-dashed border-border text-foreground-disabled'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(`kinds.${kind}`)}
                <CountChip>{kindCounts[kind]}</CountChip>
              </button>
            );
          })}
        </div>

        <div className="hidden grid-cols-3 gap-x-3 gap-y-1.5 lg:grid">
          {LEGEND.map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary">
              <span className={`h-2 w-2 rounded-full ${TONE_STYLES[entry.tone].dot}`} />
              {t(entry.key)}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary">
            <span className="h-2 w-2 rounded-full bg-surface-low ring-1 ring-inset ring-border" />
            {t('legend.weekend')}
          </span>
          <span className="inline-flex items-center gap-1.5 text-body3 text-foreground-tertiary">
            <span className="h-2 w-2 rounded-full bg-info-lighter ring-1 ring-inset ring-info/40" />
            {t('legend.holiday')}
          </span>
        </div>
      </div>
    </div>
  );
}
