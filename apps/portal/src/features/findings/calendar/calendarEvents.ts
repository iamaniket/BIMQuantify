import { Clock, Flag, ShieldCheck } from '@bimstitch/ui/icons';

import type { AppIcon } from '@bimstitch/ui';

import { isoDay, parseDayKey, toDayKey } from '@/components/shared/calendar/monthGrid';
import type { CalendarTone } from '@/components/shared/calendar/types';
import type {
  Borgingsmoment,
  BorgingsmomentStatusValue,
  Finding,
  FindingStatusValue,
} from '@/lib/api/schemas';
import type { Deadline } from '@/lib/api/schemas/deadlines';

export type CalendarEventKind = 'finding' | 'deadline' | 'borgingsmoment';

/**
 * A dated item normalized onto the unified calendar. Discriminated by `kind`
 * so the side panel can narrow `raw` to the concrete schema for its actions.
 */
export type CalendarEvent =
  | (CalendarEventBase & { kind: 'finding'; raw: Finding })
  | (CalendarEventBase & { kind: 'deadline'; raw: Deadline })
  | (CalendarEventBase & { kind: 'borgingsmoment'; raw: Borgingsmoment });

type CalendarEventBase = {
  /** Kind-prefixed id — unique across sources, used as the grid item key. */
  id: string;
  /** `YYYY-MM-DD` grid key, or null when the item has no date (→ Unscheduled). */
  isoDay: string | null;
  title: string;
  statusLabel: string;
  tone: CalendarTone;
  overdue: boolean;
};

/** Kind → icon. Distinguishes the three item types without relying on colour. */
export const KIND_ICON: Record<CalendarEventKind, AppIcon> = {
  finding: Flag,
  deadline: Clock,
  borgingsmoment: ShieldCheck,
};

/** Localized status strings, injected by the tab (one resolver per kind). */
export type CalendarLabelers = {
  findingStatus: (status: FindingStatusValue) => string;
  deadlineName: (deadline: Deadline) => string;
  deadlineStatus: (deadline: Deadline) => string;
  momentStatus: (status: BorgingsmomentStatusValue) => string;
};

/** Active (not resolved/verified) and the deadline day is before today. */
export function isFindingOverdue(finding: Finding, today: Date): boolean {
  if (finding.status === 'resolved' || finding.status === 'verified') return false;
  const key = toDayKey(finding.deadline_date);
  return key !== null && key < isoDay(today);
}

/** Mirrors `STATUS_DOT` in `FindingKanbanCard.tsx`; overdue overrides to error. */
export function findingTone(finding: Finding, overdue: boolean): CalendarTone {
  if (overdue) return 'error';
  switch (finding.status) {
    case 'open':
      return 'info';
    case 'in_progress':
      return 'primary';
    case 'resolved':
    case 'verified':
      return 'success';
    case 'draft':
    default:
      return 'neutral';
  }
}

/** Whole-day difference from today to a date string; negative = past, null = none. */
export function daysFromToday(value: string | null | undefined, today: Date): number | null {
  const key = toDayKey(value);
  if (key === null) return null;
  const target = parseDayKey(key);
  if (target === null) return null;
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

/** Ports `resolveStatus()` from `deadlines/DeadlineCard.tsx`. */
export function deadlineTone(deadline: Deadline, today: Date): CalendarTone {
  if (deadline.status === 'met') return 'success';
  if (deadline.status === 'not_applicable') return 'neutral';
  if (deadline.is_overdue) return 'error';
  const days = daysFromToday(deadline.due_date, today);
  if (days !== null && days <= 7) return 'warning';
  return 'info';
}

/** Mirrors `STATUS_BADGE` in `inspection/InspectionHeader.tsx`. */
export function momentTone(moment: Borgingsmoment): CalendarTone {
  switch (moment.status) {
    case 'in_progress':
      return 'info';
    case 'passed':
      return 'success';
    case 'failed':
      return 'error';
    case 'skipped':
      return 'warning';
    case 'planned':
    default:
      return 'neutral';
  }
}

/** The date that anchors an event on the grid, for display in the side panel. */
export function eventDateString(event: CalendarEvent): string | null {
  switch (event.kind) {
    case 'finding':
      return event.raw.deadline_date;
    case 'deadline':
      return event.raw.due_date;
    case 'borgingsmoment':
      return event.raw.actual_date ?? event.raw.planned_date;
    default:
      return null;
  }
}

/** Normalize all three sources into one flat list of calendar events. */
export function buildCalendarEvents(
  sources: { findings: Finding[]; deadlines: Deadline[]; moments: Borgingsmoment[] },
  today: Date,
  labels: CalendarLabelers,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const finding of sources.findings) {
    const overdue = isFindingOverdue(finding, today);
    events.push({
      id: `finding:${finding.id}`,
      kind: 'finding',
      isoDay: toDayKey(finding.deadline_date),
      title: finding.title,
      statusLabel: labels.findingStatus(finding.status),
      tone: findingTone(finding, overdue),
      overdue,
      raw: finding,
    });
  }

  for (const deadline of sources.deadlines) {
    events.push({
      id: `deadline:${deadline.id}`,
      kind: 'deadline',
      isoDay: toDayKey(deadline.due_date),
      title: labels.deadlineName(deadline),
      statusLabel: labels.deadlineStatus(deadline),
      tone: deadlineTone(deadline, today),
      overdue: deadline.is_overdue,
      raw: deadline,
    });
  }

  for (const moment of sources.moments) {
    events.push({
      id: `moment:${moment.id}`,
      kind: 'borgingsmoment',
      isoDay: toDayKey(moment.actual_date ?? moment.planned_date),
      title: moment.name,
      statusLabel: labels.momentStatus(moment.status),
      tone: momentTone(moment),
      overdue: false,
      raw: moment,
    });
  }

  return events;
}
