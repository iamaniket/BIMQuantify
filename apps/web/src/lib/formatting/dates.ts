/**
 * Locale-aware date formatting for the blog. Dates render in the visitor's
 * active locale (`nl` / `en`) — never a hardcoded region — so a Dutch reader
 * sees `jun.` and an English reader sees `Jun`. Mirrors the locale-aware
 * number formatting in `numbers.ts`.
 */
export function formatBlogDate(
  date: string,
  locale: string,
  monthStyle: 'short' | 'long' = 'short',
): string {
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: monthStyle,
    day: 'numeric',
  });
}
