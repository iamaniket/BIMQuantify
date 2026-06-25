import type { Locale } from '@bimdossier/i18n';

/** Canonical date: "Jun 12, 2026" (EN) / "12 jun. 2026" (NL). */
export function formatDate(
  value: string | null | undefined,
  locale: Locale,
  placeholder = '—',
): string {
  if (value === null || value === undefined || value === '') return placeholder;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return placeholder;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(parsed);
}

/** Short month + day, no year: "Jun 12" / "12 jun.". For chart axes / compact UI. */
export function formatMonthDay(
  value: string | null | undefined,
  locale: Locale,
  placeholder = '—',
): string {
  if (value === null || value === undefined || value === '') return placeholder;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return placeholder;
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(parsed);
}

/** Canonical date + time: "Jun 12, 2026, 02:30 PM" / "12 jun. 2026 14:30". */
export function formatDateTime(
  value: string | null | undefined,
  locale: Locale,
  placeholder = '—',
): string {
  if (value === null || value === undefined || value === '') return placeholder;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return placeholder;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}
