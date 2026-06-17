/** "permit_review" -> "Permit Review". Used for display-only enum strings. */
export function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * ISO date/datetime -> "Oct 31, 2026" (matches the design's card meta). Parsed
 * manually rather than via `Intl`/`toLocaleDateString` because Hermes ships only
 * a partial ICU and Android locale support is uneven — a fixed format renders
 * identically everywhere. Returns "—" for null/empty/unparseable input.
 */
export function formatShortDate(value: string | null | undefined): string {
  if (value == null || value === '') return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
