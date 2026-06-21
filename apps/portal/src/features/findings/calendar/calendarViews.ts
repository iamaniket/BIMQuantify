import {
  Columns3,
  LayoutGrid,
  Square,
} from '@bimstitch/ui/icons';

import type { AppIcon } from '@bimstitch/ui';

import type { Deadline } from '@/lib/api/schemas/deadlines';

import type { CalendarEventKind } from './calendarEvents';

export const KINDS: CalendarEventKind[] = ['finding', 'deadline', 'borgingsmoment'];

/** The three calendar layouts, à la Google Calendar. */
export type CalendarView = 'month' | 'week' | 'day';

export const VIEWS: { value: CalendarView; icon: AppIcon }[] = [
  { value: 'month', icon: LayoutGrid },
  { value: 'week', icon: Columns3 },
  { value: 'day', icon: Square },
];

/** Per-view aria labels for the single-step (‹ ›) and big-step (« ») nav. */
export const NAV_LABELS: Record<CalendarView, { single: [string, string]; big: [string, string] }> = {
  month: { single: ['prevMonth', 'nextMonth'], big: ['prevYear', 'nextYear'] },
  week: { single: ['prevWeek', 'nextWeek'], big: ['prevMonth', 'nextMonth'] },
  day: { single: ['prevDay', 'nextDay'], big: ['prevWeek', 'nextWeek'] },
};

export const LEGEND = [
  { tone: 'error', key: 'legend.overdue' },
  { tone: 'warning', key: 'legend.dueSoon' },
  { tone: 'info', key: 'legend.active' },
  { tone: 'success', key: 'legend.done' },
] as const;

export function isFilingDeadline(deadline: Deadline): boolean {
  return (
    deadline.status === 'pending'
    && (deadline.deadline_type === 'construction_notification'
      || deadline.deadline_type === 'completion_notification')
  );
}
