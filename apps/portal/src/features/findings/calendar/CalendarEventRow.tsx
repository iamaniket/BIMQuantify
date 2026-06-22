'use client';

import {
  ExternalLink,
  Move,
} from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, ReactNode } from 'react';

import { CalendarEventChip, TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding } from '@/lib/api/schemas';
import type { Deadline } from '@/lib/api/schemas/deadlines';
import type { Locale } from '@bimstitch/i18n';

import {
  eventDateString,
  KIND_ICON,
  type CalendarEvent,
} from './calendarEvents';
import {
  DraggableEvent,
} from './dnd/calendarDnd';
import { isFilingDeadline } from './calendarViews';

export function renderChip(event: CalendarEvent): ReactNode {
  const chip = (
    <CalendarEventChip tone={event.tone} icon={KIND_ICON[event.kind]} title={event.title} />
  );
  if (event.kind === 'deadline') return chip;
  return <DraggableEvent id={event.id} kind={event.kind}>{chip}</DraggableEvent>;
}

type Props = {
  event: CalendarEvent;
  draggable?: boolean;
  t: ReturnType<typeof useTranslations>;
  locale: Locale;
  projectId: string;
  onSelectFinding: (finding: Finding) => void;
  onSelectFilingDeadline: (filing: { deadline: Deadline; label: string }) => void;
};

export function CalendarEventRow({
  event,
  draggable = false,
  t,
  locale,
  projectId,
  onSelectFinding,
  onSelectFilingDeadline,
}: Props): JSX.Element {
  const Icon = KIND_ICON[event.kind];
  const dateStr = eventDateString(event);
  const isDraggable = draggable && (event.kind === 'finding' || event.kind === 'borgingsmoment');
  const secondary = `${t(`kinds.${event.kind}`)} · ${event.statusLabel}${
    dateStr !== null ? ` · ${formatDate(dateStr, locale)}` : ''
  }`;

  const inner = (
    <>
      {/* Status accent bar — clipped to the row's rounded corners. */}
      <span className={`absolute inset-y-0 left-0 w-1 ${TONE_STYLES[event.tone].dot}`} aria-hidden />
      {isDraggable && (
        <Move
          className="mt-1.5 h-3.5 w-3.5 shrink-0 text-foreground-disabled transition-colors group-hover/row:text-foreground-tertiary"
          aria-hidden
        />
      )}
      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${TONE_STYLES[event.tone].chip}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body3 font-semibold text-foreground">{event.title}</span>
        <span className="truncate text-caption text-foreground-tertiary">{secondary}</span>
      </span>
    </>
  );

  const rowClass = 'group/row relative flex w-full items-start gap-2 overflow-hidden rounded-lg border border-border bg-background py-2 pl-3 pr-2.5 text-left transition-all hover:bg-background-hover hover:shadow-sm';

  const buildRow = (): JSX.Element => {
    if (event.kind === 'finding') {
      return (
        <button type="button" className={rowClass} onClick={() => { onSelectFinding(event.raw); }}>
          {inner}
        </button>
      );
    }

    if (event.kind === 'borgingsmoment') {
      return (
        <Link
          href={`/projects/${projectId}/inspect/${event.raw.id}`}
          className={rowClass}
          aria-label={t('dayPanel.openInspection')}
        >
          {inner}
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
        </Link>
      );
    }

    if (isFilingDeadline(event.raw)) {
      return (
        <button
          type="button"
          className={rowClass}
          onClick={() => { onSelectFilingDeadline({ deadline: event.raw, label: event.title }); }}
        >
          {inner}
        </button>
      );
    }

    return <div className={rowClass}>{inner}</div>;
  };

  const row = buildRow();
  if (isDraggable) {
    return <DraggableEvent id={event.id} kind={event.kind}>{row}</DraggableEvent>;
  }
  return row;
}
