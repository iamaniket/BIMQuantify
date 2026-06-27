'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimdossier/ui';

import type { OrganizationRead } from '@/lib/api/schemas';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Retention status for a deleted org:
 *  - purged          → "Purged" (neutral)
 *  - past the window → "Eligible for removal" (error)
 *  - within window   → "Retained — N days left" (warning)
 * Renders nothing for a live (non-deleted) org.
 */
export function RetentionBadge({ org }: { org: OrganizationRead }): JSX.Element | null {
  const t = useTranslations('admin.organizations.retentionBadge');

  if (org.deleted_at === null) return null;
  if (org.purged_at !== null) {
    return <Badge variant="default">{t('purged')}</Badge>;
  }
  if (org.is_purge_eligible) {
    return <Badge variant="error">{t('eligible')}</Badge>;
  }
  const daysLeft = org.purge_eligible_at === null
    ? 0
    : Math.max(0, Math.ceil((new Date(org.purge_eligible_at).getTime() - Date.now()) / MS_PER_DAY));
  return <Badge variant="warning">{t('retained', { days: daysLeft })}</Badge>;
}
