'use client';

import {
  AlertTriangle, CalendarDays, Layers, UserRound,
} from '@bimstitch/ui/icons';
import { useLocale, useTranslations } from 'next-intl';
import {
  useCallback, useMemo, useState, type JSX,
} from 'react';

import type { Locale } from '@bimstitch/i18n';
import { Badge } from '@bimstitch/ui';

import { FindingDetailModal } from '@/features/projects/detail/FindingDetailModal';
import { severityBadgeVariant } from '@/features/projects/detail/findingBadges';
import { formatDate } from '@/lib/formatting/dates';
import type {
  Finding,
  FindingSeverityValue,
  FindingStatusValue,
  ProjectMember,
} from '@/lib/api/schemas';

const STATUS_COLORS: Record<FindingStatusValue, string> = {
  draft: 'var(--foreground-tertiary)',
  open: 'var(--info)',
  in_progress: 'var(--primary)',
  resolved: 'var(--success)',
  verified: 'var(--success)',
};

const STATUS_ORDER: FindingStatusValue[] = ['draft', 'open', 'in_progress', 'resolved', 'verified'];
const SEVERITY_ORDER: FindingSeverityValue[] = ['high', 'medium', 'low'];

const SEVERITY_COLORS: Record<FindingSeverityValue, string> = {
  high: 'var(--error)',
  medium: 'var(--warning)',
  low: 'var(--foreground-tertiary)',
};

function isActive(f: Finding): boolean {
  return f.status !== 'resolved' && f.status !== 'verified';
}

type Props = {
  projectId: string;
  findings: Finding[];
  members: ProjectMember[];
};

type SectionProps = {
  icon: JSX.Element;
  title: string;
  children: JSX.Element;
};

function Section({ icon, title, children }: SectionProps): JSX.Element {
  return (
    <div className="rounded-xl border border-border bg-surface-main p-4">
      <div className="mb-3 flex items-center gap-2 text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

type BarRowProps = {
  label: string;
  count: number;
  total: number;
  color: string;
};

function BarRow({
  label, count, total, color,
}: BarRowProps): JSX.Element {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 truncate text-body3 text-foreground-secondary">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-low">
        <div className="h-full rounded-full" style={{ width: `${String(pct)}%`, backgroundColor: color }} />
      </div>
      <span className="w-8 shrink-0 text-right text-body3 font-semibold tabular-nums text-foreground">{count}</span>
    </div>
  );
}

export function FindingsOverviewTab({ projectId, findings, members }: Props): JSX.Element {
  const t = useTranslations('findingsBoard.overview');
  const tStatus = useTranslations('findingsBoard.columns');
  const tSeverity = useTranslations('findings.severity');
  const locale = useLocale() as Locale;
  const [selected, setSelected] = useState<Finding | null>(null);

  const total = findings.length;

  const statusCounts = useMemo(() => {
    const counts = {
      draft: 0, open: 0, in_progress: 0, resolved: 0, verified: 0,
    };
    for (const f of findings) counts[f.status] += 1;
    return counts;
  }, [findings]);

  const severityCounts = useMemo(() => {
    const counts = { high: 0, medium: 0, low: 0 };
    for (const f of findings) counts[f.severity] += 1;
    return counts;
  }, [findings]);

  const assigneeName = useCallback(
    (userId: string | null): string => {
      if (userId === null) return t('unassigned');
      const m = members.find((mm) => mm.user_id === userId);
      return m?.full_name ?? m?.email ?? t('unassigned');
    },
    [members, t],
  );

  // Active (open) findings grouped by assignee, busiest first.
  const workload = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of findings) {
      if (isActive(f)) {
        const key = f.assignee_user_id ?? '__none__';
        map.set(key, (map.get(key) ?? 0) + 1);
      }
    }
    return Array.from(map.entries())
      .map(([key, count]) => ({
        label: key === '__none__' ? t('unassigned') : assigneeName(key),
        count,
      }))
      .sort((a, b) => b.count - a.count);
  }, [findings, assigneeName, t]);

  const overdue = useMemo(() => {
    const today = new Date(new Date().toDateString());
    return findings
      .filter((f) => isActive(f) && f.deadline_date !== null && new Date(f.deadline_date) < today)
      .sort((a, b) => (a.deadline_date! < b.deadline_date! ? -1 : 1));
  }, [findings]);

  const activeWorkloadTotal = workload.reduce((sum, w) => sum + w.count, 0);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Section icon={<Layers className="h-3.5 w-3.5" aria-hidden />} title={t('statusTitle')}>
        <div className="flex flex-col gap-2.5">
          {STATUS_ORDER.map((s) => (
            <BarRow
              key={s}
              label={tStatus(s)}
              count={statusCounts[s]}
              total={total}
              color={STATUS_COLORS[s]}
            />
          ))}
        </div>
      </Section>

      <Section icon={<AlertTriangle className="h-3.5 w-3.5" aria-hidden />} title={t('severityTitle')}>
        <div className="flex flex-col gap-2.5">
          {SEVERITY_ORDER.map((s) => (
            <BarRow
              key={s}
              label={tSeverity(s)}
              count={severityCounts[s]}
              total={total}
              color={SEVERITY_COLORS[s]}
            />
          ))}
        </div>
      </Section>

      <Section icon={<UserRound className="h-3.5 w-3.5" aria-hidden />} title={t('assigneeTitle')}>
        {workload.length === 0 ? (
          <p className="py-2 text-body3 text-foreground-tertiary">{t('noActive')}</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {workload.map((w) => (
              <BarRow
                key={w.label}
                label={w.label}
                count={w.count}
                total={activeWorkloadTotal}
                color="var(--primary)"
              />
            ))}
          </div>
        )}
      </Section>

      <Section icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden />} title={t('overdueTitle')}>
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
      </Section>

      <FindingDetailModal
        projectId={projectId}
        finding={selected}
        open={selected !== null}
        onOpenChange={(o) => { if (!o) setSelected(null); }}
      />
    </div>
  );
}
