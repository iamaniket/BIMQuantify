'use client';

import { FileBadge } from '@bimdossier/ui/icons';
import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@bimdossier/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';

import { useOrgCertificateStats } from './useOrgCertificates';

export function OrgCertificatesHero(): JSX.Element {
  const t = useTranslations('orgCertificates.hero');
  const { data: stats } = useOrgCertificateStats();

  const total = stats?.total ?? 0;
  const expiringSoon = stats?.expiring_soon ?? 0;
  const expired = stats?.expired ?? 0;

  return (
    <HeroShell
      image={
        <HeroImage>
          <FileBadge className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('title')}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      kpis={[
        {
          label: t('totalLabel'),
          value: String(total),
          sub: t('totalSub'),
        },
        {
          label: t('expiringLabel'),
          value: String(expiringSoon),
          sub: t('expiringSub'),
          ...(expiringSoon > 0 ? { color: 'var(--warning)' } : {}),
        },
        {
          label: t('expiredLabel'),
          value: String(expired),
          sub: t('expiredSub'),
          ...(expired > 0 ? { color: 'var(--error)' } : {}),
        },
      ]}
    />
  );
}
