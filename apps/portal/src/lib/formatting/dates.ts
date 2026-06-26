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

/** Compact locale-aware "time ago" from a duration in seconds:
 * "5 min ago" / "5 min geleden". Used for live job ages. */
export function formatAgo(seconds: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' });
  const abs = Math.max(0, Math.floor(seconds));
  if (abs < 60) return rtf.format(-abs, 'second');
  const mins = Math.floor(abs / 60);
  if (mins < 60) return rtf.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.floor(hours / 24), 'day');
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
