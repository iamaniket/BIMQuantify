'use client';

import {
  Activity, Boxes, CalendarClock, LayoutGrid, Sparkles,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { ChartBarRow } from '@/components/shared/charts/ChartBarRow';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { buildActivityTrend } from '@/features/projects/detail/ActivityTimelinePanel';
import { ActivityTrendTooltip, humanizeResource } from '@/features/projects/detail/ActivityTrendTooltip';
import type { ActivityCategory, ActivityTimeline } from '@/lib/api/schemas/activity';
import { formatMonthDay } from '@/lib/formatting/dates';

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

/** How many resource rows to list before folding the rest into "+N more". */
const MAX_RESOURCE_ROWS = 6;

/**
 * Overview tab for the dedicated Activity page — KPI cards, an activity-by-
 * category donut, an activity-by-resource breakdown, and the 8-week trend.
 * Mirrors {@link ReportsOverviewTab}; all values derive from the single all-time
 * weekly timeline query the page already holds (no extra fetch).
 */
export function ActivityOverviewTab({
  timeline,
}: {
  timeline: ActivityTimeline | undefined;
}): JSX.Element {
  const t = useTranslations('activity.hub.overview');
  const tActivity = useTranslations('activity');
  const locale = useLocale() as Locale;

  const stats = useMemo(() => {
    const buckets = timeline ?? [];
    let total = 0;
    const byCategory: Record<ActivityCategory, number> = {
      upload: 0, scan: 0, create: 0, change: 0, delete: 0,
    };
    const byResource = new Map<string, number>();
    for (const b of buckets) {
      total += b.count;
      for (const [key, n] of Object.entries(b.by_category)) {
        if (key in byCategory) byCategory[key as ActivityCategory] += n;
      }
      for (const [key, n] of Object.entries(b.by_resource)) {
        byResource.set(key, (byResource.get(key) ?? 0) + n);
      }
    }
    const resourceRows = [...byResource.entries()].sort((a, b) => b[1] - a[1]);

    const slots = buildActivityTrend(timeline, Date.now());
    const values = slots.map((s) => s.value);
    const labels = slots.map((s) => formatMonthDay(new Date(s.weekStartMs).toISOString(), locale));
    const thisWeek = slots.at(-1)?.value ?? 0;

    let busiest: ActivityCategory | null = null;
    for (const c of CATEGORY_ORDER) {
      if (byCategory[c] > 0 && (busiest === null || byCategory[c] > byCategory[busiest])) busiest = c;
    }

    return {
      total,
      byCategory,
      resourceRows,
      topResources: resourceRows.slice(0, MAX_RESOURCE_ROWS),
      distinctResources: resourceRows.length,
      slots,
      values,
      labels,
      thisWeek,
      busiest,
    };
  }, [timeline, locale]);

  const { total } = stats;

  const donutSegments = useMemo<DonutSegment[]>(
    () => CATEGORY_ORDER.map((c) => ({
      value: stats.byCategory[c],
      color: CATEGORY_COLORS[c],
      label: tActivity(CATEGORY_LABEL_KEY[c]),
    })),
    [stats.byCategory, tActivity],
  );

  const resourceLabel = (type: string): string => (
    tActivity.has(`resource.${type}`) ? tActivity(`resource.${type}`) : humanizeResource(type)
  );

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('kpiTotal')}
          value={total}
          sub={t('kpiTotalSub')}
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('kpiThisWeek')}
          value={stats.thisWeek}
          sub={t('kpiThisWeekSub')}
          icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('kpiBusiest')}
          value={stats.busiest !== null ? tActivity(CATEGORY_LABEL_KEY[stats.busiest]) : t('kpiBusiestNone')}
          {...(stats.busiest !== null
            ? { sub: t('kpiBusiestSub', { count: stats.byCategory[stats.busiest] }) }
            : {})}
          icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />}
          accent="success"
        />
        <StatCard
          label={t('kpiResources')}
          value={stats.distinctResources}
          sub={t('kpiResourcesSub')}
          icon={<Boxes className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Activity by category — donut + legend */}
        <ChartSection icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />} title={t('byCategoryTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={donutSegments}
                centerValue={String(total)}
                centerLabel={t('donutCenterLabel')}
                size={180}
              />
              <ul className="flex min-w-0 flex-1 flex-col gap-2">
                {CATEGORY_ORDER.map((c) => (
                  <li key={c} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[c] }} />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">
                      {tActivity(CATEGORY_LABEL_KEY[c])}
                    </span>
                    <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">
                      {stats.byCategory[c]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartSection>

        {/* Activity by resource — proportional bars */}
        <ChartSection icon={<Boxes className="h-3.5 w-3.5" aria-hidden />} title={t('byResourceTitle')}>
          {total === 0 || stats.topResources.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {stats.topResources.map(([type, count]) => (
                <ChartBarRow key={type} label={resourceLabel(type)} count={count} total={total} color="var(--primary)" />
              ))}
              {stats.resourceRows.length > MAX_RESOURCE_ROWS && (
                <p className="pt-1 text-caption text-foreground-tertiary">
                  {tActivity('trendTooltipMore', { count: stats.resourceRows.length - MAX_RESOURCE_ROWS })}
                </p>
              )}
            </div>
          )}
        </ChartSection>

        {/* Activity over time — 8-week trend */}
        <ChartSection
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          title={t('trendTitle')}
          className="lg:col-span-2"
        >
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('trendEmpty')}</p>
          ) : (
            <TrendArea
              values={stats.values}
              labels={stats.labels}
              height={200}
              partialLastPoint
              tooltip={(idx) => {
                const slot = stats.slots[idx];
                return slot === undefined ? null : <ActivityTrendTooltip slot={slot} />;
              }}
            />
          )}
        </ChartSection>
      </div>
    </div>
  );
}
