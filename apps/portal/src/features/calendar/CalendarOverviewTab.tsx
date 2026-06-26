'use client';

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  Clock,
  ExternalLink,
  Layers,
} from '@bimdossier/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import { Skeleton } from '@bimdossier/ui';
import type { Locale } from '@bimdossier/i18n';

import { ErrorBanner } from '@/components/shared/ErrorBanner';
import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';
import { Link } from '@/i18n/navigation';
import { formatDate, formatMonthDay } from '@/lib/formatting/dates';

import { orgDeadlineTone } from './orgDeadlineTone';
import { useOrgDeadlines, useOrgDeadlineSummary } from './useOrgDeadlines';

const UPCOMING_LIMIT = 8;
const TREND_WEEKS = 8;
const MS_DAY = 24 * 60 * 60 * 1000;

export function CalendarOverviewTab(): JSX.Element {
  const t = useTranslations('calendar.overview');
  const locale = useLocale() as Locale;

  const summaryQuery = useOrgDeadlineSummary();
  const deadlinesQuery = useOrgDeadlines();

  const summary = summaryQuery.data;
  const deadlines = useMemo(() => deadlinesQuery.data ?? [], [deadlinesQuery.data]);

  // Status donut — non-overlapping segments (overdue is carved out of pending).
  const statusSegments = useMemo<DonutSegment[]>(() => {
    if (summary === undefined) return [];
    const upcoming = Math.max(summary.pending - summary.overdue, 0);
    return [
      { value: summary.overdue, color: 'var(--error)', label: t('status.overdue') },
      { value: upcoming, color: 'var(--info)', label: t('status.upcoming') },
      { value: summary.met, color: 'var(--success)', label: t('status.met') },
      { value: summary.not_applicable, color: 'var(--foreground-tertiary)', label: t('status.notApplicable') },
    ];
  }, [summary, t]);

  const bucketCategories = useMemo(
    () => (summary?.upcoming_buckets ?? []).map((b) => t('buckets.range', { from: b.days_from, to: b.days_to })),
    [summary, t],
  );
  const bucketValues = useMemo(
    () => (summary?.upcoming_buckets ?? []).map((b) => b.count),
    [summary],
  );

  // Upcoming list — pending deadlines, soonest first (overdue lead).
  const upcoming = useMemo(
    () => deadlines
      .filter((d) => d.status === 'pending')
      .slice(0, UPCOMING_LIMIT),
    [deadlines],
  );

  // Deadlines due per week over the next TREND_WEEKS weeks (forward workload).
  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const values = new Array<number>(TREND_WEEKS).fill(0);
    let total = 0;
    for (const d of deadlines) {
      const days = d.days_until_due;
      if (days !== null && days >= 0) {
        const idx = Math.floor(days / 7);
        if (idx < TREND_WEEKS) {
          values[idx] = (values[idx] ?? 0) + 1;
          total += 1;
        }
      }
    }
    const labels = values.map(
      (_, i) => formatMonthDay(new Date(today.getTime() + i * 7 * MS_DAY).toISOString(), locale),
    );
    return { values, labels, total };
  }, [deadlines, locale]);

  const metPct = summary !== undefined && summary.total > 0
    ? Math.round((summary.met / summary.total) * 100)
    : 0;

  if (summaryQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label={t('kpiTotal')}
          value={summary?.total ?? 0}
          icon={<Layers className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('kpiPending')}
          value={summary?.pending ?? 0}
          sub={t('kpiPendingSub')}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('kpiOverdue')}
          value={summary?.overdue ?? 0}
          sub={t('kpiOverdueSub')}
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          accent="error"
        />
        <StatCard
          label={t('kpiDueThisWeek')}
          value={summary?.due_this_week ?? 0}
          sub={t('kpiDueThisWeekSub')}
          icon={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
          accent="warning"
        />
        <StatCard
          label={t('kpiMet')}
          value={`${String(metPct)}%`}
          sub={t('kpiMetSub')}
          icon={<CheckCircle className="h-3.5 w-3.5" aria-hidden />}
          accent="success"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status donut + legend */}
        <ChartSection icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('statusTitle')}>
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <DonutChart
              segments={statusSegments}
              centerValue={String(summary?.total ?? 0)}
              centerLabel={t('donutCenterLabel')}
              size={180}
            />
            <ul className="flex min-w-0 flex-1 flex-col gap-2">
              {statusSegments.map((seg) => (
                <li key={seg.label} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
                  <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{seg.label}</span>
                  <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{seg.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartSection>

        {/* Upcoming horizon bar chart */}
        <ChartSection icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />} title={t('horizonTitle')}>
          <BarChartMini categories={bucketCategories} values={bucketValues} height={200} color="var(--warning)" />
        </ChartSection>

        {/* Deadlines due over time */}
        <ChartSection
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          title={t('trendTitle')}
          className="lg:col-span-2"
        >
          {trend.total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('trendEmpty')}</p>
          ) : (
            <TrendArea values={trend.values} labels={trend.labels} height={200} color="var(--warning)" />
          )}
        </ChartSection>

        {/* Upcoming deadlines list */}
        <ChartSection
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          title={t('upcomingTitle')}
          className="lg:col-span-2"
        >
          {upcoming.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('noUpcoming')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {upcoming.map((dl) => {
                const tone = orgDeadlineTone(dl);
                const days = dl.days_until_due;
                const daysLabel = days === null
                  ? null
                  : days < 0
                    ? t('overdueDays', { days: Math.abs(days) })
                    : t('daysRemaining', { days });
                return (
                  <li key={dl.id}>
                    <Link
                      href={`/projects/${dl.project_id}`}
                      className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                    >
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${TONE_STYLES[tone].chip}`}>
                        <Clock className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body3 font-semibold text-foreground">{dl.label}</span>
                        <span className="truncate text-caption text-foreground-tertiary">{dl.project_name}</span>
                      </span>
                      {dl.due_date !== null && (
                        <span className="hidden shrink-0 text-caption tabular-nums text-foreground-tertiary sm:inline">
                          {formatDate(dl.due_date, locale)}
                        </span>
                      )}
                      {daysLabel !== null && (
                        <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${dl.is_overdue ? 'text-error' : days !== null && days <= 7 ? 'text-warning' : 'text-foreground-tertiary'}`}>
                          {daysLabel}
                        </span>
                      )}
                      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-foreground-tertiary" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ChartSection>
      </div>
    </div>
  );
}
