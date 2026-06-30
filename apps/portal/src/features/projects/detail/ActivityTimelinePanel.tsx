'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX, type ReactNode } from 'react';

import type { Locale } from '@bimdossier/i18n';

import { TrendArea } from '@/components/shared/charts/TrendArea';
import { listProjectActivityTimeline } from '@/lib/api/activity';
import type { ActivityTimeline } from '@/lib/api/schemas/activity';
import { formatMonthDay } from '@/lib/formatting/dates';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { ActivityTrendTooltip } from './ActivityTrendTooltip';
import { projectActivityTimelineKey } from '../queryKeys';

const WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

// Stable literal so the query key never churns across renders. Weekly buckets
// are tiny even over a multi-year project, so we fetch the whole trend (no
// `since`) and slot the most recent 8 weeks client-side.
const TIMELINE_PARAMS = { bucket: 'week' } as const;

export function useProjectActivityTimeline(projectId: string, free = false) {
  return useAuthQuery<ActivityTimeline>({
    // A project id is globally unique to one tier, so the key needs no `free`
    // bit — the fetch path branches on it (free derives the trend, paid reads
    // the org audit feed). See `lib/api/scope.ts`.
    queryKey: [...projectActivityTimelineKey(projectId, TIMELINE_PARAMS)],
    queryFn: (token) => listProjectActivityTimeline(token, projectId, TIMELINE_PARAMS, free),
    enabled: projectId.length > 0,
  });
}

/** One densified slot of the 8-week activity axis. Carries the merged
 * per-category / per-resource breakdowns so the hover tooltip can show
 * "10 activities — 4 created, 3 changes · 5 findings, 3 reports". */
export type ActivitySlot = {
  value: number;
  byCategory: Record<string, number>;
  byResource: Record<string, number>;
  /** Start of the slot's calendar week (UTC-midnight Monday), drives the label. */
  weekStartMs: number;
  /** The trailing slot — the current, only-partly-elapsed week. */
  isCurrentWeek: boolean;
};

/** UTC midnight of the Monday on or before `ms`. Mirrors the backend's
 * `date_trunc('week')` (ISO weeks start Monday, emitted as UTC midnight), so a
 * bucket and its slot share a week boundary regardless of the viewer's timezone.
 * The old today-anchored 7-day windows put the current week's bucket one slot
 * early and left the trailing point empty; UTC alignment fixes that everywhere
 * (a local-time variant would still misfire west of UTC). */
function startOfWeekUtc(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay(); // 0=Sun … 6=Sat
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.getTime();
}

/** Densify the server's non-empty weekly buckets into a fixed 8-calendar-week
 * axis ending on the current week. Pure + exported so it's trivially
 * unit-testable (see `ActivityTimelinePanel.test.tsx`). The last slot is flagged
 * `isCurrentWeek` — it's the current, only-partly-elapsed week (rendered as an
 * in-progress marker), not a dip in real activity. */
export function buildActivityTrend(
  timeline: ActivityTimeline | undefined,
  nowMs: number,
): ActivitySlot[] {
  const currentWeekStart = startOfWeekUtc(nowMs);
  const slots: ActivitySlot[] = Array.from({ length: WEEKS }, (_, i) => ({
    value: 0,
    byCategory: {},
    byResource: {},
    // UTC has no DST, so whole-week offsets are exact.
    weekStartMs: currentWeekStart - (WEEKS - 1 - i) * MS_WEEK,
    isCurrentWeek: i === WEEKS - 1,
  }));

  for (const b of timeline ?? []) {
    const ts = new Date(b.bucket_start).getTime();
    if (Number.isNaN(ts)) continue;
    // Match by calendar week: how many whole weeks back is this bucket's week
    // from the current one. Exact integer division (UTC, no DST).
    const weeksAgo = Math.round((currentWeekStart - startOfWeekUtc(ts)) / MS_WEEK);
    const idx = WEEKS - 1 - weeksAgo;
    if (idx < 0 || idx > WEEKS - 1) continue;
    const slot = slots[idx];
    if (slot === undefined) continue;
    slot.value += b.count;
    for (const [key, n] of Object.entries(b.by_category)) {
      slot.byCategory[key] = (slot.byCategory[key] ?? 0) + n;
    }
    for (const [key, n] of Object.entries(b.by_resource)) {
      slot.byResource[key] = (slot.byResource[key] ?? 0) + n;
    }
  }

  return slots;
}

/** Pure presentational trend — densifies the server's non-empty weekly buckets
 * into a fixed 8-week axis. Split from the fetching wrapper so it's trivially
 * testable (see `ActivityTimelinePanel.test.tsx`). */
export function ActivityTimelineView({
  timeline,
  isLoading,
  headerAction,
}: {
  timeline: ActivityTimeline | undefined;
  isLoading: boolean;
  /** Optional control rendered to the right of the title (e.g. a "View all" link). */
  headerAction?: ReactNode;
}): JSX.Element {
  const t = useTranslations('activity');
  const locale = useLocale() as Locale;

  const {
    values, labels, slots, total,
  } = useMemo(() => {
    const built = buildActivityTrend(timeline, Date.now());
    return {
      slots: built,
      values: built.map((s) => s.value),
      labels: built.map((s) => formatMonthDay(new Date(s.weekStartMs).toISOString(), locale)),
      total: built.reduce((sum, s) => sum + s.value, 0),
    };
  }, [timeline, locale]);

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="text-body2 font-bold text-foreground">{t('trendTitle')}</h3>
        {headerAction}
      </div>
      <div className="p-4">
        {isLoading ? (
          <div className="h-[150px] animate-pulse rounded-md bg-surface-low" />
        ) : total === 0 ? (
          <div className="flex h-[150px] items-center justify-center text-body3 text-foreground-tertiary">
            {t('trendEmpty')}
          </div>
        ) : (
          <TrendArea
            values={values}
            labels={labels}
            height={150}
            partialLastPoint
            tooltip={(idx) => {
              const slot = slots[idx];
              return slot === undefined ? null : <ActivityTrendTooltip slot={slot} />;
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Activity-over-time trend card. Sits directly below the "Project completeness"
 * section on the project detail page; fetches its own data and is independent of
 * the activity-list filters. */
export function ActivityTimelinePanel({
  projectId,
  free = false,
  headerAction,
}: {
  projectId: string;
  /** Route the fetch to the free wedge's derived trend (`/free/...`) instead of
   * the paid org audit feed. Defaults to the paid path. */
  free?: boolean;
  /** Optional control rendered in the card header (e.g. a "View all" link). The
   * caller owns it so this module stays free of the next-intl navigation import
   * that breaks the pure-view unit test. */
  headerAction?: ReactNode;
}): JSX.Element {
  const { data, isLoading } = useProjectActivityTimeline(projectId, free);
  return (
    <ActivityTimelineView timeline={data} isLoading={isLoading} headerAction={headerAction} />
  );
}
