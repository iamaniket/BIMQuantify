'use client';

import {
  ChevronDown,
  ChevronUp,
  Move,
} from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { CountChip } from '@bimdossier/ui';

import { type CalendarEvent } from './calendarEvents';
import { DroppableUnscheduled } from './dnd/calendarDnd';

type Props = {
  t: ReturnType<typeof useTranslations>;
  unscheduled: CalendarEvent[];
  draggingDatedFinding: boolean;
  unscheduledOpen: boolean;
  onToggleOpen: () => void;
  renderRow: (event: CalendarEvent) => ReactNode;
};

export function ProjectCalendarUnscheduled({
  t,
  unscheduled,
  draggingDatedFinding,
  unscheduledOpen,
  onToggleOpen,
  renderRow,
}: Props): JSX.Element {
  return (
    <DroppableUnscheduled>
      <div
        className={`shrink-0 border-t px-4 py-2 transition-colors ${
          draggingDatedFinding
            ? 'border-dashed border-primary bg-primary-lighter/50'
            : 'border-border bg-surface-low'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={onToggleOpen}
            className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-foreground-tertiary transition-colors hover:text-foreground-secondary"
          >
            {unscheduledOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            {t('unscheduled')}
            {unscheduled.length > 0 && <CountChip>{unscheduled.length}</CountChip>}
          </button>
          {draggingDatedFinding && (
            <span className="flex items-center gap-1.5 text-caption font-medium text-primary">
              <Move className="h-3.5 w-3.5" aria-hidden />
              {t('dropToUnschedule')}
            </span>
          )}
        </div>
        {unscheduledOpen && unscheduled.length > 0 && (
          <ul className="mt-2 grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
            {unscheduled.map((event) => (
              <li key={event.id}>{renderRow(event)}</li>
            ))}
          </ul>
        )}
      </div>
    </DroppableUnscheduled>
  );
}
