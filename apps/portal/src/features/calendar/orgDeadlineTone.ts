import type { CalendarTone } from '@/components/shared/calendar/types';
import type { CalendarDeadline } from '@/lib/api/schemas/deadlines';

/**
 * Status → calendar tone for an org-wide deadline. Mirrors `deadlineTone()` in
 * `findings/calendar/calendarEvents.ts`, but reads the server-computed
 * `days_until_due` rather than recomputing from the date string.
 */
export function orgDeadlineTone(d: CalendarDeadline): CalendarTone {
  if (d.status === 'met') return 'success';
  if (d.status === 'not_applicable') return 'neutral';
  if (d.is_overdue) return 'error';
  if (d.days_until_due !== null && d.days_until_due <= 7) return 'warning';
  return 'info';
}
