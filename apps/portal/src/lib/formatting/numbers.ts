/**
 * Format a count for display by flooring to one significant figure and
 * suffixing with "+" when rounding actually happened.
 *
 *   9    -> "9"
 *   14   -> "10+"
 *   121  -> "100+"
 *   1234 -> "1000+"
 *
 * Used for public-facing aggregate stats (e.g. the pre-login projects /
 * cities counter). The server's `/public/projects-map` endpoint already
 * floors per-city counts the same way before they leave the database, so
 * exact tenant numbers never reach the client. This helper enforces the
 * same rule on values that are derived client-side (sums, array lengths).
 */
export function formatApproxCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const floored = approxCountFloor(n);
  return n < 10 ? String(floored) : `${String(floored)}+`;
}

function approxCountFloor(n: number): number {
  if (n < 10) return Math.max(0, Math.floor(n));
  const magnitude = 10 ** Math.floor(Math.log10(n));
  return Math.floor(n / magnitude) * magnitude;
}
