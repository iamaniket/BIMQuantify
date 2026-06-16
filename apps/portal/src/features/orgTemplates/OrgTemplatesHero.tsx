'use client';

import { Layers } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';

import type { AllTemplatesStats } from './useAllTemplates';

type Props = { stats: AllTemplatesStats };

export function OrgTemplatesHero({ stats }: Props): JSX.Element {
  const t = useTranslations('orgTemplates.hero');

  return (
    <HeroShell
      image={
        <HeroImage>
          <Layers className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('title')}
      kpis={[
        { label: t('totalLabel'), value: String(stats.totalCount), sub: t('totalSub') },
        {
          label: t('findingDefaultLabel'),
          value: stats.findingDefault?.name ?? t('noDefault'),
          sub: t('findingDefaultSub'),
        },
      ]}
    />
  );
}
