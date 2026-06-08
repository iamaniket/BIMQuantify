'use client';

import { Layers } from '@bimstitch/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimstitch/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';

import { useFindingTemplates } from './useFindingTemplates';

export function FindingTemplatesHero(): JSX.Element {
  const t = useTranslations('findingTemplates.hero');
  const { data } = useFindingTemplates();
  const templates = data ?? [];
  const total = templates.length;
  const defaultTemplate = templates.find((tpl) => tpl.is_default) ?? null;

  return (
    <HeroShell
      image={
        <HeroImage>
          <Layers className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('title')}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      kpis={[
        { label: t('totalLabel'), value: String(total), sub: t('totalSub') },
        {
          label: t('defaultLabel'),
          value: defaultTemplate?.name ?? t('noDefault'),
          sub: t('defaultSub'),
        },
      ]}
    />
  );
}
