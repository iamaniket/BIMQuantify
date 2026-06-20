'use client';

import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CheckCircle,
  Clock,
  ExternalLink,
  Layers,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX, type ReactNode } from 'react';

import { Skeleton } from '@bimstitch/ui';
import type { Locale } from '@bimstitch/i18n';

import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TONE_STYLES } from '@/components/shared/calendar/CalendarEventChip';
import { Link } from '@/i18n/navigation';
import { formatDate } from '@/lib/formatting/dates';
import type { CalendarDeadline } from '@/lib/api/schemas/deadlines';

import { orgDeadlineTone } from './orgDeadlineTone';
import { useOrgDeadlines, useOrgDeadlineSummary } from './useOrgDeadlines';

const UPCOMING_LIMIT = 8;

type SectionProps = {
  icon: JSX.Element;
  title: string;
  className?: string;
  children: ReactNode;
};

function Section({
  icon, title, className, children,
}: SectionProps): JSX.Element {
  return (
    <div className={`rounded-xl border border-border bg-surface-main p-4 ${className ?? ''}`}>
      <div className="mb-3 flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

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
        <Section icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('statusTitle')}>
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
        </Section>

        {/* Upcoming horizon bar chart */}
        <Section icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />} title={t('horizonTitle')}>
          <BarChartMini categories={bucketCategories} values={bucketValues} height={200} color="var(--warning)" />
        </Section>

        {/* Upcoming deadlines list */}
        <Section
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
        </Section>
      </div>
    </div>
  );
}
