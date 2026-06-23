'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';

import { TrendArea } from '@/components/shared/charts/TrendArea';
import { listProjectActivityTimeline } from '@/lib/api/activity';
import type { ActivityTimeline } from '@/lib/api/schemas/activity';
import { formatMonthDay } from '@/lib/formatting/dates';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { projectActivityTimelineKey } from '../queryKeys';

const WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

// Stable literal so the query key never churns across renders. Weekly buckets
// are tiny even over a multi-year project, so we fetch the whole trend (no
// `since`) and slot the most recent 8 weeks client-side.
const TIMELINE_PARAMS = { bucket: 'week' } as const;

function useProjectActivityTimeline(projectId: string) {
  return useAuthQuery<ActivityTimeline>({
    queryKey: [...projectActivityTimelineKey(projectId, TIMELINE_PARAMS)],
    queryFn: (token) => listProjectActivityTimeline(token, projectId, TIMELINE_PARAMS),
    enabled: projectId.length > 0,
  });
}

/** Pure presentational trend — densifies the server's non-empty weekly buckets
 * into a fixed 8-week axis. Split from the fetching wrapper so it's trivially
 * testable (see `ActivityTimelinePanel.test.tsx`). */
export function ActivityTimelineView({
  timeline,
  isLoading,
}: {
  timeline: ActivityTimeline | undefined;
  isLoading: boolean;
}): JSX.Element {
  const t = useTranslations('activity');
  const locale = useLocale() as Locale;

  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const start = today.getTime() - (WEEKS - 1) * MS_WEEK;
    const values = new Array<number>(WEEKS).fill(0);
    let total = 0;
    for (const b of timeline ?? []) {
      const ts = new Date(b.bucket_start).getTime();
      if (Number.isNaN(ts)) continue;
      let idx = Math.floor((ts - start) / MS_WEEK);
      if (idx >= WEEKS) idx = WEEKS - 1;
      if (idx >= 0) {
        values[idx] = (values[idx] ?? 0) + b.count;
        total += b.count;
      }
    }
    const labels = values.map(
      (_, i) => formatMonthDay(new Date(start + i * MS_WEEK).toISOString(), locale),
    );
    return { values, labels, total };
  }, [timeline, locale]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-body2 font-bold text-foreground">{t('trendTitle')}</h3>
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="h-[150px] animate-pulse rounded-md bg-surface-low" />
        ) : trend.total === 0 ? (
          <div className="flex h-[150px] items-center justify-center text-body3 text-foreground-tertiary">
            {t('trendEmpty')}
          </div>
        ) : (
          <TrendArea values={trend.values} labels={trend.labels} height={150} />
        )}
      </div>
    </div>
  );
}

/** Activity-over-time trend card. Sits directly below the "Project completeness"
 * section on the project detail page; fetches its own data and is independent of
 * the activity-list filters. */
export function ActivityTimelinePanel({ projectId }: { projectId: string }): JSX.Element {
  const { data, isLoading } = useProjectActivityTimeline(projectId);
  return <ActivityTimelineView timeline={data} isLoading={isLoading} />;
}
