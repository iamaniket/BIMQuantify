'use client';

import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ExternalLink,
  X,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import {
  useMemo, useState, type JSX, type ReactNode,
} from 'react';

import { Button, CountChip, IconButton } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { CalendarEventChip, TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';
import { MonthCalendar } from '@/components/shared/calendar/MonthCalendar';
import {
  addMonths,
  addYears,
  dayHeading,
  isSameMonth,
  monthLabel,
  parseDayKey,
  startOfMonth,
} from '@/components/shared/calendar/monthGrid';
import { useBorgingsplan } from '@/features/borgingsplan/useBorgingsplan';
import { useUpdateMoment } from '@/features/borgingsplan/useMomentMutations';
import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { useHolidays } from '@/features/jurisdictions/useHolidays';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { FilingDialog } from '@/features/projects/detail/deadlines/FilingDialog';
import { useProjectDeadlineSettings } from '@/features/projects/detail/deadlines/useDeadlineNotificationSettings';
import { useDeadlines } from '@/features/projects/detail/deadlines/useDeadlines';
import { useProject } from '@/features/projects/useProject';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/formatting/dates';
import type { Finding } from '@/lib/api/schemas';
import type { Deadline } from '@/lib/api/schemas/deadlines';

import {
  buildCalendarEvents,
  eventDateString,
  KIND_ICON,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarLabelers,
} from './calendarEvents';
import {
  DAY_DROP_PREFIX,
  DraggableEvent,
  DroppableDay,
  DroppableUnscheduled,
  UNSCHEDULED_DROP_ID,
} from './dnd/calendarDnd';

const KINDS: CalendarEventKind[] = ['finding', 'deadline', 'borgingsmoment'];

const LEGEND = [
  { tone: 'error', key: 'legend.overdue' },
  { tone: 'warning', key: 'legend.dueSoon' },
  { tone: 'info', key: 'legend.active' },
  { tone: 'success', key: 'legend.done' },
] as const;

function isFilingDeadline(deadline: Deadline): boolean {
  return (
    deadline.status === 'pending'
    && (deadline.deadline_type === 'construction_notification'
      || deadline.deadline_type === 'completion_notification')
  );
}

type Props = {
  projectId: string;
  findings: Finding[];
};

export function ProjectCalendarTab({ projectId, findings }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.calendar');
  const tFindingStatus = useTranslations('findingsBoard.columns');
  const tDeadline = useTranslations('projectDetail.tabs.deadlines');
  const tMoment = useTranslations('inspection');
  const locale = useLocale() as Locale;

  const projectQuery = useProject(projectId);
  const deadlinesQuery = useDeadlines(projectId);
  const settingsQuery = useProjectDeadlineSettings(projectId);
  const planQuery = useBorgingsplan(projectId);

  const updateFinding = useUpdateFinding(projectId);
  const planId = planQuery.data?.id ?? null;
  const updateMoment = useUpdateMoment(projectId, planId ?? '');

  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const [viewDate, setViewDate] = useState<Date>(() => startOfMonth(today));
  const [kindFilters, setKindFilters] = useState<Record<CalendarEventKind, boolean>>({
    finding: true,
    deadline: true,
    borgingsmoment: true,
  });
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [unscheduledOpen, setUnscheduledOpen] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [filingDeadline, setFilingDeadline] = useState<
    { deadline: Deadline; label: string } | null
  >(null);
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);

  const deadlines = useMemo(() => deadlinesQuery.data ?? [], [deadlinesQuery.data]);
  const settings = useMemo(() => settingsQuery.data ?? [], [settingsQuery.data]);
  const moments = useMemo(() => planQuery.data?.moments ?? [], [planQuery.data]);

  // Holidays for the year(s) the 6-week grid can show (an extra year only
  // bleeds in at the Jan/Dec edges).
  const visibleYears = useMemo(() => {
    const year = viewDate.getFullYear();
    const years = new Set([year]);
    if (viewDate.getMonth() === 0) years.add(year - 1);
    if (viewDate.getMonth() === 11) years.add(year + 1);
    return Array.from(years);
  }, [viewDate]);
  const holidaysByDay = useHolidays(projectQuery.data?.country, visibleYears);

  const deadlineLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const setting of settings) map.set(setting.deadline_type, setting.label);
    return map;
  }, [settings]);

  const labelers = useMemo<CalendarLabelers>(() => ({
    findingStatus: (status) => tFindingStatus(status),
    deadlineName: (deadline) => (
      deadlineLabels.get(deadline.deadline_type) ?? deadline.deadline_type
    ),
    deadlineStatus: (deadline) => {
      if (deadline.status === 'met') return tDeadline('statuses.met');
      if (deadline.status === 'not_applicable') return tDeadline('statuses.notApplicable');
      if (deadline.is_overdue) return tDeadline('statuses.overdue');
      return tDeadline('statuses.pending');
    },
    momentStatus: (status) => tMoment(`status.${status}`),
  }), [tFindingStatus, tDeadline, tMoment, deadlineLabels]);

  const events = useMemo(
    () => buildCalendarEvents({ findings, deadlines, moments }, today, labelers),
    [findings, deadlines, moments, today, labelers],
  );

  const eventsById = useMemo(() => {
    const map = new Map<string, CalendarEvent>();
    for (const event of events) map.set(event.id, event);
    return map;
  }, [events]);

  const kindCounts = useMemo(() => {
    const counts: Record<CalendarEventKind, number> = {
      finding: 0, deadline: 0, borgingsmoment: 0,
    };
    for (const event of events) counts[event.kind] += 1;
    return counts;
  }, [events]);

  const visibleEvents = useMemo(
    () => events.filter((event) => kindFilters[event.kind]),
    [events, kindFilters],
  );

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of visibleEvents) {
      if (event.isoDay !== null) {
        const bucket = map.get(event.isoDay);
        if (bucket === undefined) map.set(event.isoDay, [event]);
        else bucket.push(event);
      }
    }
    return map;
  }, [visibleEvents]);

  const overdueDays = useMemo(() => {
    const set = new Set<string>();
    for (const event of visibleEvents) {
      if (event.overdue && event.isoDay !== null) set.add(event.isoDay);
    }
    return set;
  }, [visibleEvents]);

  const unscheduled = useMemo(
    () => visibleEvents.filter((event) => event.isoDay === null),
    [visibleEvents],
  );

  const selectedDate = selectedDay === null ? null : parseDayKey(selectedDay);
  const dayEvents = selectedDay === null ? [] : itemsByDay.get(selectedDay) ?? [];

  const isLoading = deadlinesQuery.isLoading || planQuery.isLoading || settingsQuery.isLoading;
  const isCurrentMonth = isSameMonth(viewDate, today);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const toggleKind = (kind: CalendarEventKind): void => {
    setKindFilters((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };

  const handleDragStart = (event: DragStartEvent): void => {
    setActiveEvent(eventsById.get(String(event.active.id)) ?? null);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    setActiveEvent(null);
    const { active, over } = event;
    if (over === null) return;
    const dragged = eventsById.get(String(active.id));
    if (dragged === undefined) return;
    const overId = String(over.id);

    // Drop on the unscheduled tray → clear the date (findings only; a moment's
    // planned_date is required, so it cannot be un-scheduled).
    if (overId === UNSCHEDULED_DROP_ID) {
      if (dragged.kind === 'finding' && dragged.isoDay !== null) {
        updateFinding.mutate({ findingId: dragged.raw.id, input: { deadline_date: null } });
      }
      return;
    }

    // Drop on a day → set / move the date.
    if (overId.startsWith(DAY_DROP_PREFIX)) {
      const iso = overId.slice(DAY_DROP_PREFIX.length);
      if (dragged.isoDay === iso) return; // no-op: same day
      if (dragged.kind === 'finding') {
        updateFinding.mutate({ findingId: dragged.raw.id, input: { deadline_date: iso } });
      } else if (dragged.kind === 'borgingsmoment' && planId !== null) {
        updateMoment.mutate({ momentId: dragged.raw.id, input: { planned_date: iso } });
      }
      // Deadlines are system-managed → never draggable, so unreachable here.
    }
  };

  const renderChip = (event: CalendarEvent): ReactNode => {
    const chip = (
      <CalendarEventChip tone={event.tone} icon={KIND_ICON[event.kind]} title={event.title} />
    );
    if (event.kind === 'deadline') return chip;
    return <DraggableEvent id={event.id} kind={event.kind}>{chip}</DraggableEvent>;
  };

  function renderEventRow(event: CalendarEvent, draggable = false): JSX.Element {
    const Icon = KIND_ICON[event.kind];
    const dateStr = eventDateString(event);
    const secondary = `${t(`kinds.${event.kind}`)} · ${event.statusLabel}${
      dateStr !== null ? ` · ${formatDate(dateStr, locale)}` : ''
    }`;

    const inner = (
      <>
        <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${TONE_STYLES[event.tone].chip}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body3 font-medium text-foreground">{event.title}</span>
          <span className="truncate text-caption text-foreground-tertiary">{secondary}</span>
        </span>
      </>
    );

    const rowClass = 'flex w-full items-start gap-2 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:bg-background-hover';

    const buildRow = (): JSX.Element => {
      if (event.kind === 'finding') {
        return (
          <button type="button" className={rowClass} onClick={() => { setSelectedFinding(event.raw); }}>
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
            onClick={() => { setFilingDeadline({ deadline: event.raw, label: event.title }); }}
          >
            {inner}
          </button>
        );
      }

      return <div className={rowClass}>{inner}</div>;
    };

    const row = buildRow();
    if (draggable && (event.kind === 'finding' || event.kind === 'borgingsmoment')) {
      return <DraggableEvent id={event.id} kind={event.kind}>{row}</DraggableEvent>;
    }
    return row;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar: month/year navigation + kind filters + status legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-1">
          <IconButton size="sm" icon={ChevronsLeft} aria-label={t('prevYear')} onClick={() => { setViewDate((d) => addYears(d, -1)); }} />
          <IconButton size="sm" icon={ChevronLeft} aria-label={t('prevMonth')} onClick={() => { setViewDate((d) => addMonths(d, -1)); }} />
          <span className="min-w-[140px] text-center text-body3 font-semibold capitalize text-foreground">
            {monthLabel(viewDate, locale)}
          </span>
          <IconButton size="sm" icon={ChevronRight} aria-label={t('nextMonth')} onClick={() => { setViewDate((d) => addMonths(d, 1)); }} />
          <IconButton size="sm" icon={ChevronsRight} aria-label={t('nextYear')} onClick={() => { setViewDate((d) => addYears(d, 1)); }} />
          <Button
            size="sm"
            variant="border"
            className="ml-1"
            disabled={isCurrentMonth}
            onClick={() => { setViewDate(startOfMonth(today)); }}
          >
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t('today')}
          </Button>
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
                  className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-caption font-medium transition-colors ${
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

          <div className="hidden items-center gap-2.5 lg:flex">
            {LEGEND.map((entry) => (
              <span key={entry.key} className="inline-flex items-center gap-1 text-caption text-foreground-tertiary">
                <span className={`h-2 w-2 rounded-full ${TONE_STYLES[entry.tone].dot}`} />
                {t(entry.key)}
              </span>
            ))}
            <span className="inline-flex items-center gap-1 text-caption text-foreground-tertiary">
              <span className="h-2 w-2 rounded-full bg-surface-low ring-1 ring-inset ring-border" />
              {t('legend.weekend')}
            </span>
            <span className="inline-flex items-center gap-1 text-caption text-foreground-tertiary">
              <span className="h-2 w-2 rounded-full bg-info-lighter ring-1 ring-inset ring-info/40" />
              {t('legend.holiday')}
            </span>
          </div>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => { setActiveEvent(null); }}
      >
        {/* Body: grid + day-agenda side panel */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col overflow-auto p-3.5">
            {events.length === 0 && !isLoading && (
              <p className="mb-3 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center text-body3 text-foreground-tertiary">
                {t('empty')}
              </p>
            )}
            <MonthCalendar<CalendarEvent>
              className="min-h-0 flex-1"
              viewDate={viewDate}
              today={today}
              locale={locale}
              itemsByDay={itemsByDay}
              getItemId={(event) => event.id}
              renderChip={renderChip}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
              moreLabel={(count) => t('moreCount', { count })}
              holidaysByDay={holidaysByDay}
              overdueDays={overdueDays}
              wrapDay={(iso, cell) => <DroppableDay iso={iso}>{cell}</DroppableDay>}
            />
          </div>

          {selectedDay !== null && selectedDate !== null && (
            <aside className="flex w-80 shrink-0 flex-col border-l border-border bg-surface-main">
              <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-body3 font-semibold capitalize text-foreground">
                    {dayHeading(selectedDate, locale)}
                  </span>
                  <span className="text-caption text-foreground-tertiary">
                    {t('dayPanel.count', { count: dayEvents.length })}
                  </span>
                </div>
                <IconButton icon={X} aria-label={t('dayPanel.close')} onClick={() => { setSelectedDay(null); }} />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <ul className="flex flex-col gap-1.5">
                  {dayEvents.map((event) => (
                    <li key={event.id}>{renderEventRow(event)}</li>
                  ))}
                </ul>
              </div>
            </aside>
          )}
        </div>

        {/* Unscheduled: items with no date (mostly findings without a deadline).
            Drop a calendar item here to clear its date. */}
        {unscheduled.length > 0 && (
          <DroppableUnscheduled>
            <div className="shrink-0 border-t border-border bg-surface-low px-4 py-2">
              <button
                type="button"
                onClick={() => { setUnscheduledOpen((v) => !v); }}
                className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-foreground-tertiary"
              >
                {unscheduledOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                {t('unscheduled')}
                <CountChip>{unscheduled.length}</CountChip>
              </button>
              {unscheduledOpen && (
                <ul className="mt-2 grid max-h-40 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                  {unscheduled.map((event) => (
                    <li key={event.id}>{renderEventRow(event, true)}</li>
                  ))}
                </ul>
              )}
            </div>
          </DroppableUnscheduled>
        )}

        <DragOverlay dropAnimation={null}>
          {activeEvent !== null && (
            <div className="rounded-md border border-primary bg-background px-2 py-1 shadow-lg">
              <CalendarEventChip
                tone={activeEvent.tone}
                icon={KIND_ICON[activeEvent.kind]}
                title={activeEvent.title}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <FindingDetailModal
        projectId={projectId}
        finding={selectedFinding}
        open={selectedFinding !== null}
        onOpenChange={(open) => { if (!open) setSelectedFinding(null); }}
      />

      {filingDeadline !== null && (
        <FilingDialog
          open
          onOpenChange={(open) => { if (!open) setFilingDeadline(null); }}
          projectId={projectId}
          deadline={filingDeadline.deadline}
          label={filingDeadline.label}
        />
      )}
    </div>
  );
}
