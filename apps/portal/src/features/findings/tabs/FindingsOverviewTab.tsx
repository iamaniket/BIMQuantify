'use client';

import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle,
  Clock,
  Layers,
  Plus,
  UserRound,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { BarChartMini } from '@/components/shared/charts/BarChartMini';
import { ChartBarRow } from '@/components/shared/charts/ChartBarRow';
import { ChartSection } from '@/components/shared/charts/ChartSection';
import { DonutChart, type DonutSegment } from '@/components/shared/charts/DonutChart';
import { StatCard } from '@/components/shared/charts/StatCard';
import { TrendArea } from '@/components/shared/charts/TrendArea';
import { STATUS_COLORS, STATUS_ORDER, SEVERITY_ORDER } from '@/features/findings/findingChartConstants';
import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { severityBadgeVariant } from '@/features/projects/detail/findingBadges';
import { formatDate, formatMonthDay } from '@/lib/formatting/dates';
import type {
  Finding,
  FindingSeverityValue,
  FindingStatusValue,
  ProjectMember,
} from '@/lib/api/schemas';

const TREND_WEEKS = 8;
const MS_WEEK = 7 * 24 * 60 * 60 * 1000;

function isActive(f: Finding): boolean {
  return f.status !== 'resolved' && f.status !== 'verified';
}

type Props = {
  projectId: string;
  findings: Finding[];
  members: ProjectMember[];
};

export function FindingsOverviewTab({ projectId, findings, members }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.overview');
  const tStatus = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const locale = useLocale() as Locale;
  const [selected, setSelected] = useState<Finding | null>(null);

  const total = findings.length;

  const statusCounts = useMemo(() => {
    const counts: Record<FindingStatusValue, number> = {
      draft: 0, open: 0, in_progress: 0, resolved: 0, verified: 0,
    };
    for (const f of findings) counts[f.status] += 1;
    return counts;
  }, [findings]);

  const severityCounts = useMemo(() => {
    const counts: Record<FindingSeverityValue, number> = { high: 0, medium: 0, low: 0 };
    for (const f of findings) counts[f.severity] += 1;
    return counts;
  }, [findings]);

  const assigneeName = useCallback(
    (userId: string | null): string => {
      if (userId === null) return t('unassigned');
      const m = members.find((mm) => mm.user_id === userId);
      if (m === undefined) return t('unassigned');
      return m.full_name ?? m.email;
    },
    [members, t],
  );

  // Active (open) findings grouped by assignee, busiest first. Group by the
  // resolved display label (not the raw user id) so that genuinely-unassigned
  // findings and findings assigned to a non-member — both of which render as
  // "Unassigned" — collapse into one bucket instead of producing duplicate rows
  // (and duplicate React keys).
  const workload = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) {
      if (isActive(f)) {
        const label = assigneeName(f.assignee_user_id);
        map.set(label, (map.get(label) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  }, [findings, assigneeName]);

  const overdue = useMemo(() => {
    const today = new Date(new Date().toDateString());
    return findings
      .filter((f) => isActive(f) && f.deadline_date !== null && new Date(f.deadline_date) < today)
      .sort((a, b) => {
        const da = a.deadline_date ?? '';
        const db = b.deadline_date ?? '';
        return da < db ? -1 : 1;
      });
  }, [findings]);

  // KPI tiles.
  const kpis = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    const weekAhead = new Date(today);
    weekAhead.setDate(today.getDate() + 7);

    let open = 0;
    let dueSoon = 0;
    let created7d = 0;
    for (const f of findings) {
      const active = isActive(f);
      if (active) open += 1;
      if (new Date(f.created_at) >= weekAgo) created7d += 1;
      if (active && f.deadline_date !== null) {
        const d = new Date(f.deadline_date);
        if (d >= today && d <= weekAhead) dueSoon += 1;
      }
    }
    const resolved = total - open;
    return {
      open,
      dueSoon,
      created7d,
      resolvedPct: total > 0 ? Math.round((resolved / total) * 100) : 0,
    };
  }, [findings, total]);

  // Findings created per week over the last TREND_WEEKS weeks.
  const trend = useMemo(() => {
    const today = new Date(new Date().toDateString());
    const start = today.getTime() - (TREND_WEEKS - 1) * MS_WEEK;
    const values = new Array<number>(TREND_WEEKS).fill(0);
    for (const f of findings) {
      const ts = new Date(f.created_at).getTime();
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
  }, [findings, locale]);

  const statusSegments = useMemo<DonutSegment[]>(
    () => STATUS_ORDER.map((s) => ({
      value: statusCounts[s],
      color: STATUS_COLORS[s],
      label: tStatus(s),
    })),
    [statusCounts, tStatus],
  );

  const severityCategories = useMemo(() => SEVERITY_ORDER.map((s) => tSeverity(s)), [tSeverity]);
  const severityValues = useMemo(
    () => SEVERITY_ORDER.map((s) => severityCounts[s]),
    [severityCounts],
  );

  const activeWorkloadTotal = workload.reduce((sum, w) => sum + w.count, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* KPI stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label={t('kpiTotal')}
          value={total}
          icon={<Layers className="h-3.5 w-3.5" aria-hidden />}
          accent="neutral"
        />
        <StatCard
          label={t('kpiOpen')}
          value={kpis.open}
          sub={t('kpiOpenSub')}
          icon={<Clock className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('kpiOverdue')}
          value={overdue.length}
          sub={t('kpiOverdueSub')}
          icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />}
          accent="error"
        />
        <StatCard
          label={t('kpiDueSoon')}
          value={kpis.dueSoon}
          sub={t('kpiDueSoonSub')}
          icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />}
          accent="warning"
        />
        <StatCard
          label={t('kpiNew')}
          value={kpis.created7d}
          sub={t('kpiNewSub')}
          icon={<Plus className="h-3.5 w-3.5" aria-hidden />}
          accent="primary"
        />
        <StatCard
          label={t('kpiResolved')}
          value={`${String(kpis.resolvedPct)}%`}
          sub={t('kpiResolvedSub')}
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
              centerValue={String(total)}
              centerLabel={t('donutCenterLabel')}
              size={180}
            />
            <ul className="flex min-w-0 flex-1 flex-col gap-2">
              {STATUS_ORDER.map((s) => (
                <li key={s} className="flex items-center gap-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: STATUS_COLORS[s] }} />
                  <span className="min-w-0 flex-1 truncate text-body3 text-foreground-secondary">{tStatus(s)}</span>
                  <span className="shrink-0 text-body3 font-semibold tabular-nums text-foreground">{statusCounts[s]}</span>
                </li>
              ))}
            </ul>
          </div>
        </ChartSection>

        {/* Severity bar chart */}
        <ChartSection icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />} title={t('severityTitle')}>
          <BarChartMini categories={severityCategories} values={severityValues} height={200} />
        </ChartSection>

        {/* Created over time */}
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

        {/* Assignee workload */}
        <ChartSection icon={<UserRound className="h-3.5 w-3.5" aria-hidden />} title={t('assigneeTitle')}>
          {workload.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('noActive')}</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {workload.map((w) => (
                <ChartBarRow key={w.label} label={w.label} count={w.count} total={activeWorkloadTotal} color="var(--primary)" />
              ))}
            </div>
          )}
        </ChartSection>

        {/* Overdue items */}
        <ChartSection icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />} title={t('overdueTitle')}>
          {overdue.length === 0 ? (
            <p className="py-2 text-body3 text-foreground-tertiary">{t('noOverdue')}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {overdue.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => { setSelected(f); }}
                    className="flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors hover:bg-background-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-body3 font-medium text-foreground">{f.title}</span>
                    <Badge variant={severityBadgeVariant(f.severity)} size="md" bordered>
                      {tSeverity(f.severity)}
                    </Badge>
                    <span className="shrink-0 text-[11px] font-semibold tabular-nums text-error">
                      {formatDate(f.deadline_date, locale)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </ChartSection>
      </div>

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
