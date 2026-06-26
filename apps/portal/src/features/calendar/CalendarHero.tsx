'use client';

import { CalendarDays } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell } from '@/components/shared/layout/HeroShell';

import { useOrgDeadlineSummary } from './useOrgDeadlines';

const DASH = '—';

export function CalendarHero(): JSX.Element {
  const t = useTranslations('calendar.hero');
  const { data } = useOrgDeadlineSummary();

  return (
    <HeroShell
      image={
        <HeroImage>
          <CalendarDays className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      }
      title={t('title')}
      description={t('subtitle')}
      kpis={[
        {
          label: t('pendingLabel'),
          value: data ? String(data.pending) : DASH,
          sub: t('pendingSub'),
        },
        {
          label: t('overdueLabel'),
          value: data ? String(data.overdue) : DASH,
          sub: t('overdueSub'),
        },
        {
          label: t('dueThisWeekLabel'),
          value: data ? String(data.due_this_week) : DASH,
          sub: t('dueThisWeekSub'),
        },
      ]}
    />
  );
}
