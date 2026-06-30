'use client';

import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { Button } from '@bimdossier/ui';

import { useFreeLimits } from '@/hooks/useFreeLimits';
import { Link } from '@/i18n/navigation';

// Start nudging once the free trial is within this many days of ending; before
// that the banner stays hidden so it doesn't nag for the whole window.
const NUDGE_THRESHOLD_DAYS = 30;

/**
 * Free-tier trial banner for the dashboard shell. Self-gating: `useFreeLimits`
 * only fires for org-less (free) users, and the banner renders nothing unless
 * the trial has ended OR is within {@link NUDGE_THRESHOLD_DAYS} of ending (and
 * the account isn't admin-exempted). Once expired the free workspace is
 * read-only (the API returns 403 FREE_ACCOUNT_EXPIRED on writes); the CTA points
 * at the upgrade (request-access) flow.
 */
export function TrialBanner(): JSX.Element | null {
  const t = useTranslations('freeTrial');
  const { data } = useFreeLimits();

  if (data === undefined || data.expiry_exempt) {
    return null;
  }

  const { expired } = data;
  const daysLeft = data.days_remaining;
  const ending = !expired && daysLeft !== null && daysLeft <= NUDGE_THRESHOLD_DAYS;
  if (!expired && !ending) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-low px-5 py-2.5">
      <div className="min-w-0">
        <p
          className={
            expired
              ? 'text-body3 font-semibold text-error'
              : 'text-body3 font-semibold text-warning'
          }
        >
          {expired ? t('expiredTitle') : t('daysLeft', { days: daysLeft ?? 0 })}
        </p>
        <p className="text-caption text-foreground-secondary">
          {expired ? t('expiredBody') : t('endingBody')}
        </p>
      </div>
      <Button asChild variant="primary">
        <Link href="/request-access">{t('cta')}</Link>
      </Button>
    </div>
  );
}
