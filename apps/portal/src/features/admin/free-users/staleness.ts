// Staleness logic for free-tier accounts, shared by the list table and the
// Manage detail panel so both flag removal candidates identically.

/**
 * Days of inactivity after which a free account is flagged "stale" (a removal
 * candidate). Mirrors the API's `free_model_idle_ttl_days` (the reaper window).
 */
export const STALE_AFTER_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The account's most recent sign of life: real content activity when present,
 * otherwise the account-creation date (so a signup that never did anything
 * still ages from when it was created).
 */
export function effectiveActivity(
  createdAt: string,
  lastActivityAt: string | null | undefined,
): string {
  return lastActivityAt ?? createdAt;
}

/** True when the account has had no activity for more than STALE_AFTER_DAYS. */
export function isStaleAccount(
  createdAt: string,
  lastActivityAt: string | null | undefined,
): boolean {
  const ts = Date.parse(effectiveActivity(createdAt, lastActivityAt));
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts > STALE_AFTER_DAYS * MS_PER_DAY;
}
