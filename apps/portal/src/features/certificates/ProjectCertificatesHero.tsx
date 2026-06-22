'use client';

import { FileBadge } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';
import type { KpiItem } from '@/components/shared/layout/KpiCard';
import type { Certificate } from '@/lib/api/schemas';

import { getCertificateExpiryState } from './expiry';

type Props = {
  projectName: string;
  certificates: Certificate[];
};

export function ProjectCertificatesHero({ projectName, certificates }: Props): JSX.Element {
  const t = useTranslations('certificates.hub.hero');

  const stats = useMemo(() => {
    let valid = 0;
    let expiring = 0;
    let expired = 0;
    for (const c of certificates) {
      const state = getCertificateExpiryState(c.valid_until);
      if (state === 'valid') valid++;
      else if (state === 'expiring') expiring++;
      else if (state === 'expired') expired++;
    }
    return { total: certificates.length, valid, expiring, expired };
  }, [certificates]);

  const kpis: KpiItem[] = [
    { label: t('totalLabel'), value: String(stats.total), sub: t('totalSub') },
    {
      label: t('validLabel'),
      value: String(stats.valid),
      sub: t('validSub'),
      ...(stats.valid > 0 ? { color: 'var(--success)' } : {}),
    },
    {
      label: t('expiringLabel'),
      value: String(stats.expiring),
      sub: t('expiringSub'),
      ...(stats.expiring > 0 ? { color: 'var(--warning)' } : {}),
    },
    {
      label: t('expiredLabel'),
      value: String(stats.expired),
      sub: t('expiredSub'),
      ...(stats.expired > 0 ? { color: 'var(--error)' } : {}),
    },
  ];

  return (
    <HeroShell
      image={(
        <HeroImage>
          <FileBadge className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      )}
      title={projectName}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      subtitle={<span>{t('subtitle')}</span>}
      kpis={kpis}
    />
  );
}
