/**
 * Format a count for display by flooring to one significant figure and
 * suffixing with "+" when rounding actually happened.
 *
 *   9    -> "9"
 *   14   -> "10+"
 *   121  -> "100+"
 *   1234 -> "1000+"
 *
 * Mirrors `apps/portal/src/lib/formatting/numbers.ts`. The marketing site
 * has no shared package with the portal, so this is duplicated by design
 * — the surface is one tiny pure function.
 */
function approxCountFloor(n: number): number {
  if (n < 10) return Math.max(0, Math.floor(n));
  const magnitude = 10 ** Math.floor(Math.log10(n));
  return Math.floor(n / magnitude) * magnitude;
}

export function formatApproxCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const floored = approxCountFloor(n);
  return n < 10 ? String(floored) : `${String(floored)}+`;
}
