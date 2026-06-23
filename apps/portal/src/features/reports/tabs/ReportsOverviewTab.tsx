'use client';

import {
  Activity, CheckCircle, Clock, FileText, Layers, LayoutGrid,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type JSX } from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { formatDate, formatMonthDay } from '@/lib/formatting/dates';
import type { Report, ReportStatus, ReportType } from '@/lib/api/schemas/reports';

import { REPORT_TYPE_META, REPORT_TYPE_ORDER, STATUS_TONE } from '../reportTypeMeta';

// Status colors lean on success for the terminal "ready" state, with primary/
// warning for in-flight and error for failed — see CLAUDE.md token rule.
const STATUS_COLORS: Record<ReportStatus, string> = {
  ready: 'var(--success)',
  running: 'var(--warning)',
  queued: 'var(--primary)',
  failed: 'var(--error)',
};

const STATUS_ORDER: ReportStatus[] = ['ready', 'running', 'queued', 'failed'];

const TREND_WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

export function ReportsOverviewTab({ reports }: { reports: Report[] }): JSX.Element {
  const t = useTranslations('reports.hub.overview');
  const tReports = useTranslations('reports');
  const locale = useLocale() as Locale;

  const total = reports.length;

  const statusCounts = useMemo(() => {
    const counts: Record<ReportStatus, number> = {
      queued: 0, running: 0, ready: 0, failed: 0,
    };
    for (const r of reports) counts[r.status] += 1;
    return counts;
  }, [reports]);

  const typeCounts = useMemo(() => {
    const counts = new Map<ReportType, number>();
    for (const r of reports) counts.set(r.report_type, (counts.get(r.report_type) ?? 0) + 1);
    return counts;
  }, [reports]);

  // Newest report per type (the list is already newest-first, but compare
  // defensively so order assumptions don't leak in).
  const latestPerType = useMemo(() => {
    const map = new Map<ReportType, Report>();
    for (const r of reports) {
      const cur = map.get(r.report_type);
      if (cur === undefined || r.created_at > cur.created_at) map.set(r.report_type, r);
    }
    return map;
  }, [reports]);

  const typesCovered = REPORT_TYPE_ORDER.filter((rt) => (typeCounts.get(rt) ?? 0) > 0).length;
  const pending = statusCounts.queued + statusCounts.running;

  const statusSegments = useMemo<DonutSegment[]>(
    () => STATUS_ORDER.map((s) => ({
      value: statusCounts[s],
      color: STATUS_COLORS[s],
      label: tReports(`shared.status.${s}`),
    })),
    [statusCounts, tReports],
  );

  const typeCategories = useMemo(
    () => REPORT_TYPE_ORDER.map((rt) => tReports(`types.${rt}.title`)),
    [tReports],
  );
  const typeValues = useMemo(
    () => REPORT_TYPE_ORDER.map((rt) => typeCounts.get(rt) ?? 0),
    [typeCounts],
  );

  // Reports generated per week over the last TREND_WEEKS weeks.
  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const start = today.getTime() - (TREND_WEEKS - 1) * MS_WEEK;
    const values = new Array<number>(TREND_WEEKS).fill(0);
    for (const r of reports) {
      const ts = new Date(r.created_at).getTime();
      if (!Number.isNaN(ts)) {
        let idx = Math.floor((ts - start) / MS_WEEK);
        if (idx >= TREND_WEEKS) idx = TREND_WEEKS - 1; // clamp future-dated
        if (idx >= 0) values[idx] = (values[idx] ?? 0) + 1;
      }
    }
    const labels = values.map(
      (_, i) => formatMonthDay(new Date(start + i * MS_WEEK).toISOString(), locale),
    );
    return { values, labels };
  }, [reports, locale]);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label={t('kpiTotal')}
          value={total}
          icon={<FileText className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('kpiReady')}
          value={statusCounts.ready}
          sub={t('kpiReadySub')}
          icon={<CheckCircle className="h-3.5 w-3.5" aria-hidden />}
          accent="success"
        />
        <StatCard
          label={t('kpiPending')}
          value={pending}
          sub={t('kpiPendingSub')}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('kpiTypes')}
          value={`${String(typesCovered)}/${String(REPORT_TYPE_ORDER.length)}`}
          sub={t('kpiTypesSub')}
          icon={<Layers className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status donut + legend */}
        <ChartSection icon={<LayoutGrid className="h-3.5 w-3.5" aria-hidden />} title={t('statusTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <div className="flex flex-col items-center gap-5 sm:flex-row">
              <DonutChart
                segments={statusSegments}
                centerValue={String(total)}
                centerLabel={t('donutCenterLabel')}
                size={180}
              />
              <ul className="flex min-w-0 flex-1 flex-col gap-2">
                {STATUS_ORDER.map((s) => (
                  <li key={s} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                    <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">
                      {tReports(`shared.status.${s}`)}
                    </span>
                    <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">
                      {statusCounts[s]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartSection>

        {/* Reports per type */}
        <ChartSection icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('byTypeTitle')}>
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('empty')}</p>
          ) : (
            <BarChartMini categories={typeCategories} values={typeValues} height={200} />
          )}
        </ChartSection>

        {/* Generated over time */}
        <ChartSection
          icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
          title={t('trendTitle')}
          className="lg:col-span-2"
        >
          {total === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('trendEmpty')}</p>
          ) : (
            <TrendArea values={trend.values} labels={trend.labels} height={200} />
          )}
        </ChartSection>

        {/* Latest generation per type */}
        <ChartSection
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          title={t('latestTitle')}
          className="lg:col-span-2"
        >
          <ul className="flex flex-col gap-1.5">
            {REPORT_TYPE_ORDER.map((rt) => {
              const meta = REPORT_TYPE_META[rt];
              const Icon = meta.icon;
              const latest = latestPerType.get(rt);
              return (
                <li
                  key={rt}
                  className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${meta.tileClass}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">
                    {tReports(`types.${rt}.title`)}
                  </span>
                  {latest === undefined ? (
                    <span className="shrink-0 text-caption text-foreground-tertiary">
                      {t('latestNotGenerated')}
                    </span>
                  ) : (
                    <>
                      <span className="shrink-0 text-caption tabular-nums text-foreground-tertiary">
                        {formatDate(latest.created_at, locale)}
                      </span>
                      <Badge variant={STATUS_TONE[latest.status]} size="sm" className="shrink-0 capitalize">
                        {tReports(`shared.status.${latest.status}`)}
                      </Badge>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </ChartSection>
      </div>
    </div>
  );
}
