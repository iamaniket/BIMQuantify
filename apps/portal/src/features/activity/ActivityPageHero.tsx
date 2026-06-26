'use client';

import { Activity } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Badge } from '@bimdossier/ui';

import { HeroImage } from '@/components/shared/layout/HeroImage';
import { HeroShell, type KpiItem } from '@/components/shared/layout/HeroShell';
import { buildActivityTrend } from '@/features/projects/detail/ActivityTimelinePanel';
import type { ActivityCategory, ActivityTimeline } from '@/lib/api/schemas/activity';

const CATEGORY_ORDER: readonly ActivityCategory[] = ['upload', 'scan', 'create', 'change', 'delete'];

const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  upload: 'var(--primary)',
  scan: 'var(--success)',
  create: 'var(--info)',
  change: 'var(--warning)',
  delete: 'var(--error)',
};

const CATEGORY_LABEL_KEY: Record<ActivityCategory, string> = {
  upload: 'typeUploads',
  scan: 'typeScans',
  create: 'typeCreate',
  change: 'typeChanges',
  delete: 'typeDelete',
};

/**
 * Identity + KPI hero for the dedicated project Activity page, mirroring
 * {@link ReportsPageHero}. Headline stats (total events, this week, busiest
 * category) are derived from the same all-time weekly timeline the page already
 * fetches, so this hero adds no network call.
 */
export function ActivityPageHero({
  projectName,
  timeline,
}: {
  projectName: string;
  timeline: ActivityTimeline | undefined;
}): JSX.Element {
  const t = useTranslations('activity.hub.hero');
  const tActivity = useTranslations('activity');

  const stats = useMemo(() => {
    const buckets = timeline ?? [];
    let total = 0;
    const byCategory: Record<ActivityCategory, number> = {
      upload: 0, scan: 0, create: 0, change: 0, delete: 0,
    };
    for (const b of buckets) {
      total += b.count;
      for (const [key, n] of Object.entries(b.by_category)) {
        if (key in byCategory) byCategory[key as ActivityCategory] += n;
      }
    }
    const thisWeek = buildActivityTrend(timeline, Date.now()).at(-1)?.value ?? 0;
    let busiest: ActivityCategory | null = null;
    for (const c of CATEGORY_ORDER) {
      if (byCategory[c] > 0 && (busiest === null || byCategory[c] > byCategory[busiest])) busiest = c;
    }
    return { total, byCategory, thisWeek, busiest };
  }, [timeline]);

  const kpis: KpiItem[] = [
    {
      label: t('totalLabel'),
      value: String(stats.total),
      sub: t('totalSub', { count: stats.total }),
    },
    {
      label: t('weekLabel'),
      value: String(stats.thisWeek),
      sub: t('weekSub'),
      ...(stats.thisWeek > 0 ? { color: 'var(--primary)' } : {}),
    },
    {
      label: t('busiestLabel'),
      value: stats.busiest !== null ? tActivity(CATEGORY_LABEL_KEY[stats.busiest]) : t('busiestNone'),
      sub: stats.busiest !== null
        ? t('busiestSub', { count: stats.byCategory[stats.busiest] })
        : t('busiestNoneSub'),
      ...(stats.busiest !== null ? { color: CATEGORY_COLORS[stats.busiest] } : {}),
    },
  ];

  return (
    <HeroShell
      image={(
        <HeroImage>
          <Activity className="h-12 w-12 text-primary-foreground" />
        </HeroImage>
      )}
      title={projectName}
      badge={<Badge variant="info">{t('badge')}</Badge>}
      subtitle={<span>{t('subtitle')}</span>}
      kpis={kpis}
    />
  );
}
