'use client';

import { FileBadge } from 'lucide-react';
import type { JSX } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@bimstitch/ui';

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
        <div className="flex h-[140px] w-[200px] items-center justify-center rounded-[10px] bg-gradient-to-br from-primary to-primary-light text-primary-foreground shadow-[0_4px_14px_rgba(44,86,151,0.12)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.30)]">
          <FileBadge className="h-12 w-12" />
        </div>
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
