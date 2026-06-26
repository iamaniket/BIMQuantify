'use client';

import type { Locale } from '@bimdossier/i18n';
import { BookOpen, Mail } from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell, type KpiItem } from '@/components/shared/layout/HeroShell';
import { formatDate } from '@/lib/formatting/dates';

import { SUPPORT_EMAIL } from './content/support';
import { useHelpStats } from './useHelpContent';

export function HelpHero(): ReactNode {
  const t = useTranslations('help');
  const locale = useLocale() as Locale;
  const stats = useHelpStats();

  const kpis: KpiItem[] = [
    { label: t('kpis.articles'), value: String(stats.articleCount) },
    { label: t('kpis.categories'), value: String(stats.categoryCount) },
    { label: t('kpis.updated'), value: formatDate(stats.lastUpdated, locale) },
    {
      label: t('kpis.support'),
      value: t('kpis.supportValue'),
      sub: (
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <Mail className="h-3 w-3" />
          {SUPPORT_EMAIL}
        </a>
      ),
    },
  ];

  return (
    <HeroShell
      image={
        <HeroImage>
          <BookOpen className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('hero.title')}
      description={t('hero.description')}
      kpis={kpis}
    />
  );
}
