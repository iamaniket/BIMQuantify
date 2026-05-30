export type CertificateExpiryState = 'none' | 'valid' | 'expiring' | 'expired';

export const EXPIRY_WARNING_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Classify a certificate's `valid_until` into an expiry bucket that drives the
 * green/amber/red badge. A null `valid_until` means "never expires" → `none`.
 * Comparison is date-only (the input is an ISO date string like `2026-05-30`).
 */
export function getCertificateExpiryState(
  validUntil: string | null,
  now: Date = new Date(),
): CertificateExpiryState {
  if (validUntil === null || validUntil === '') return 'none';
  const until = Date.parse(`${validUntil.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(until)) return 'none';
  const today = Date.parse(
    `${now.toISOString().slice(0, 10)}T00:00:00Z`,
  );
  const daysLeft = Math.floor((until - today) / MS_PER_DAY);
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRY_WARNING_DAYS) return 'expiring';
  return 'valid';
}
