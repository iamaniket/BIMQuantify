'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { useCountUp } from '@/hooks/useCountUp';

import { AnimatedBarRow } from './AnimatedBarRow';
import { AnimatedDonut } from './AnimatedDonut';
import { DEMO_DASHBOARD, type DemoDiscipline } from './demoWorkflow';

const DISCIPLINES: readonly DemoDiscipline[] = [
  'structure',
  'installations',
  'finishing',
  'facade',
];

type StatTileProps = {
  label: string;
  value: string;
  accent?: 'primary' | 'neutral';
};

/**
 * Modeled on the portal's StatCard (label eyebrow + big tabular number).
 * Bespoke here because `@bimdossier/brand`'s KpiStrip renders values in the
 * display serif and raw hex — both off-limits in web chrome.
 */
function StatTile({ label, value, accent = 'neutral' }: StatTileProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-surface-main p-3.5">
      <span className="truncate text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
        {label}
      </span>
      <span
        className={`text-title1 font-semibold leading-none tabular-nums ${
          accent === 'primary' ? 'text-primary' : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

type LegendItemProps = {
  dotClass: string;
  label: string;
  value: number;
};

function LegendItem({ dotClass, label, value }: LegendItemProps): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption text-foreground-tertiary">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      {label}
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
    </span>
  );
}

type Props = {
  /** Reveal gate from the section's `useInView` (true instantly under reduced motion). */
  drawn: boolean;
  dossierReadyPct: number;
  openFindings: number;
  donut: { complete: number; pending: number; missing: number };
  disciplineCounts: Record<DemoDiscipline, number>;
};

/**
 * The demo project's dashboard rail: 4 KPI tiles, the dossier donut and the
 * per-discipline bars — every figure derived from the board state next to it.
 * Reveal choreography: KPI count-ups stagger 0/120/240/360 ms, the donut
 * sweeps from 200 ms, bars grow staggered 80 ms; post-reveal data changes
 * ride CSS transitions inside the chart components.
 */
export function DemoDashboard({
  drawn,
  dossierReadyPct,
  openFindings,
  donut,
  disciplineCounts,
}: Props): JSX.Element {
  const t = useTranslations('workflowDemo');

  const pct = useCountUp(dossierReadyPct, { active: drawn });
  const open = useCountUp(openFindings, { active: drawn, delay: 120 });
  const met = useCountUp(DEMO_DASHBOARD.deadlinesMet, { active: drawn, delay: 240 });
  const days = useCountUp(DEMO_DASHBOARD.daysToGereedmelding, { active: drawn, delay: 360 });

  const barTotal = Math.max(1, ...DISCIPLINES.map((d) => disciplineCounts[d]));

  return (
    <div className="flex flex-col gap-4">
      {/* Honesty rule: these are a demo project's numbers, never company metrics. */}
      <div className="flex justify-end">
        <span className="rounded-full bg-surface-low px-2 py-0.5 text-caption font-medium text-foreground-tertiary ring-1 ring-border">
          {t('demoBadge')}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label={t('kpis.completeness.label')}
          value={`${String(pct)}%`}
          accent="primary"
        />
        <StatTile label={t('kpis.openFindings.label')} value={String(open)} />
        <StatTile
          label={t('kpis.deadlines.label')}
          value={t('kpis.deadlines.value', { met, total: DEMO_DASHBOARD.deadlinesTotal })}
        />
        <StatTile label={t('kpis.days.label')} value={String(days)} />
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface-main p-4">
        <AnimatedDonut
          drawn={drawn}
          segments={[
            { value: donut.complete, color: 'var(--success)' },
            { value: donut.pending, color: 'var(--warning)' },
            { value: donut.missing, color: 'var(--surface-low)' },
          ]}
          centerValue={`${String(pct)}%`}
          centerLabel={t('donut.centerLabel')}
        />
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <LegendItem dotClass="bg-success" label={t('donut.complete')} value={donut.complete} />
          <LegendItem dotClass="bg-warning" label={t('donut.pending')} value={donut.pending} />
          <LegendItem
            dotClass="bg-surface-low ring-1 ring-border"
            label={t('donut.missing')}
            value={donut.missing}
          />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-main p-4">
        <span className="text-caption font-bold uppercase tracking-widest text-foreground-tertiary">
          {t('barsTitle')}
        </span>
        <div className="flex flex-col gap-2">
          {DISCIPLINES.map((discipline, i) => (
            <AnimatedBarRow
              key={discipline}
              label={t(`disciplines.${discipline}`)}
              count={disciplineCounts[discipline]}
              total={barTotal}
              color="var(--primary)"
              drawn={drawn}
              delay={i * 80}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
