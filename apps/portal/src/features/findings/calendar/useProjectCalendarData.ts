'use client';

import {
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useLocale, useTranslations } from 'next-intl';
import {
  useMemo, useState,
} from 'react';

import type { Locale } from '@bimdossier/i18n';

import {
  addDays,
  addMonths,
  addWeeks,
  addYears,
  buildWeekDays,
  isoDay,
  isSameDay,
  isSameMonth,
  isSameWeek,
  monthLabel,
  parseDayKey,
  weekRangeLabel,
  fullDayHeading,
} from '@/components/shared/calendar/monthGrid';
import { useBorgingsplan } from '@/features/borgingsplan/useBorgingsplan';
import { useUpdateMoment } from '@/features/borgingsplan/useMomentMutations';
import { useUpdateFinding } from '@/features/findings/useUpdateFinding';
import { useHolidays } from '@/features/jurisdictions/useHolidays';
import { useProjectDeadlineSettings } from '@/features/projects/detail/deadlines/useDeadlineNotificationSettings';
import { useDeadlines } from '@/features/projects/detail/deadlines/useDeadlines';
import { useProject } from '@/features/projects/useProject';
import type { Finding } from '@/lib/api/schemas';
import type { Deadline } from '@/lib/api/schemas/deadlines';

import {
  buildCalendarEvents,
  type CalendarEvent,
  type CalendarEventKind,
  type CalendarLabelers,
} from './calendarEvents';
import {
  DAY_DROP_PREFIX,
  UNSCHEDULED_DROP_ID,
} from './dnd/calendarDnd';
import {
  NAV_LABELS,
  type CalendarView,
} from './calendarViews';

export function useProjectCalendarData(projectId: string, findings: Finding[]) {
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

  const [view, setView] = useState<CalendarView>('month');
  // Anchor day for the viewed period (the month/week/day it falls in).
  const [viewDate, setViewDate] = useState<Date>(today);
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

  // Week view: the 7 Monday-first day cells around the anchor.
  const weekDays = useMemo(() => buildWeekDays(viewDate, today), [viewDate, today]);
  // Day view: the focused day and its events.
  const dayKey = isoDay(viewDate);
  const dayViewEvents = itemsByDay.get(dayKey) ?? [];
  const dayHoliday = holidaysByDay.get(dayKey) ?? null;

  const isLoading = deadlinesQuery.isLoading || planQuery.isLoading || settingsQuery.isLoading;

  // Whether the viewed period already contains today (disables "Today").
  const isCurrentPeriod = view === 'month'
    ? isSameMonth(viewDate, today)
    : view === 'week'
      ? isSameWeek(viewDate, today)
      : isSameDay(viewDate, today);

  // Localized header label for the active period.
  const periodLabel = view === 'month'
    ? monthLabel(viewDate, locale)
    : view === 'week'
      ? weekRangeLabel(viewDate, locale)
      : fullDayHeading(viewDate, locale);

  const navLabels = NAV_LABELS[view];

  // True while a dated finding is mid-drag — invites a drop on the unscheduled
  // tray to clear its date.
  const draggingDatedFinding = activeEvent !== null
    && activeEvent.kind === 'finding'
    && activeEvent.isoDay !== null;

  const toggleKind = (kind: CalendarEventKind): void => {
    setKindFilters((prev) => ({ ...prev, [kind]: !prev[kind] }));
  };

  const changeView = (next: CalendarView): void => {
    setView(next);
    setSelectedDay(null); // the side panel only belongs to the month grid
  };

  // Step the anchor by one unit of the active view; `big` jumps a larger unit.
  const stepBy = (dir: -1 | 1, big: boolean): void => {
    setViewDate((d) => {
      if (view === 'month') return big ? addYears(d, dir) : addMonths(d, dir);
      if (view === 'week') return big ? addMonths(d, dir) : addWeeks(d, dir);
      return big ? addWeeks(d, dir) : addDays(d, dir);
    });
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

  const handleDragCancel = (): void => {
    setActiveEvent(null);
  };

  return {
    t,
    locale,
    view,
    viewDate,
    setViewDate,
    kindFilters,
    selectedDay,
    setSelectedDay,
    unscheduledOpen,
    setUnscheduledOpen,
    selectedFinding,
    setSelectedFinding,
    filingDeadline,
    setFilingDeadline,
    activeEvent,
    today,
    events,
    kindCounts,
    itemsByDay,
    overdueDays,
    unscheduled,
    selectedDate,
    dayEvents,
    weekDays,
    dayKey,
    dayViewEvents,
    dayHoliday,
    holidaysByDay,
    isLoading,
    isCurrentPeriod,
    periodLabel,
    navLabels,
    draggingDatedFinding,
    planId,
    toggleKind,
    changeView,
    stepBy,
    handleDragStart,
    handleDragEnd,
    handleDragCancel,
  };
}
