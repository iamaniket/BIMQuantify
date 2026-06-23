'use client';

import { useMemo, type JSX } from 'react';

import { useTranslations } from 'next-intl';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@bimstitch/ui';

import { DrilldownDonut, type DonutWedge } from '@/components/shared/charts/DrilldownDonut';
import { STATUS_COLORS, STATUS_ORDER } from '@/features/findings/findingChartConstants';
import { useJurisdiction } from '@/features/jurisdictions/useJurisdictions';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import type { Deadline, Finding } from '@/lib/api/schemas';

import { type DossierCompleteness } from './dossierTemplate';
import {
  ringPct,
  selectDeadlinesBreakdown,
  selectFindingsBreakdown,
} from './progressRings/ringSelectors';

type Props = {
  dossier: DossierCompleteness;
  findings: Finding[];
  deadlines: Deadline[];
  country: string;
};

/** Distinct token palette for the dossier-by-category breakdown. */
const PALETTE = [
  'var(--primary)',
  'var(--success)',
  'var(--warning)',
  'var(--info)',
  'var(--error)',
  'var(--primary-hover)',
];
const OVERFLOW_COLOR = 'var(--foreground-tertiary)';

/**
 * Project completeness panel. A single {@link DrilldownDonut} whose three wedges
 * — Dossier, Findings, Deadlines — reshape into their own breakdowns when
 * clicked. This component is a thin data-mapping wrapper: it turns the
 * already-fetched dossier/findings/deadlines into wedge props and owns the card
 * shell; all interaction + animation lives in the primitive.
 */
export function ProjectChartsPanel({ dossier, findings, deadlines, country }: Props): JSX.Element {
  const tRings = useTranslations('projectDetail.tabs.chartsPanel.rings');
  const tExp = useTranslations('projectDetail.tabs.chartsPanel.expanded');
  const tStatus = useTranslations('findingsBoard.columns');
  const reducedMotion = useReducedMotion();
  const jurisdiction = useJurisdiction(country);

  const findingsB = useMemo(() => selectFindingsBreakdown(findings), [findings]);
  const deadlinesB = useMemo(() => selectDeadlinesBreakdown(deadlines), [deadlines]);

  const wedges = useMemo<DonutWedge[]>(() => {
    const categoryLabel = (code: string): string =>
      jurisdiction?.dossier_category_labels[code] ?? code;

    return [
      {
        key: 'dossier',
        label: tRings('dossierLabel'),
        color: 'var(--success)',
        weight: Math.max(dossier.total, 1),
        meta: { value: dossier.filled, total: dossier.total, pct: dossier.pct },
        center: { value: `${String(dossier.pct)}%`, label: tRings('dossierLabel') },
        detail: dossier.groups.map((g, i) => ({
          label: `${categoryLabel(g.category)} · ${String(g.filled)}/${String(g.total)}`,
          value: g.filled,
          color: PALETTE[i % PALETTE.length] ?? OVERFLOW_COLOR,
        })),
        empty: tExp('emptyDossier'),
      },
      {
        key: 'findings',
        label: tRings('findingsLabel'),
        color: 'var(--primary)',
        weight: Math.max(findingsB.total, 1),
        meta: {
          value: findingsB.complete,
          total: findingsB.total,
          pct: ringPct(findingsB.complete, findingsB.total),
        },
        center: { value: String(findingsB.total), label: tRings('findingsLabel') },
        detail: STATUS_ORDER.map((s) => ({
          label: tStatus(s),
          value: findingsB.byStatus[s],
          color: STATUS_COLORS[s],
        })),
        empty: tExp('emptyFindings'),
      },
      {
        key: 'deadlines',
        label: tRings('deadlinesLabel'),
        color: 'var(--warning)',
        weight: Math.max(deadlinesB.total, 1),
        meta: {
          value: deadlinesB.met,
          total: deadlinesB.total,
          pct: ringPct(deadlinesB.met, deadlinesB.total),
        },
        center: { value: `${String(deadlinesB.met)}/${String(deadlinesB.total)}`, label: tRings('deadlinesLabel') },
        detail: [
          { label: tExp('deadlinesMet'), value: deadlinesB.met, color: 'var(--success)' },
          { label: tExp('deadlinesPending'), value: deadlinesB.pending, color: 'var(--foreground-tertiary)' },
          { label: tExp('deadlinesOverdue'), value: deadlinesB.overdue, color: 'var(--error)' },
        ],
        empty: tExp('emptyDeadlines'),
      },
    ];
  }, [dossier, findingsB, deadlinesB, tRings, tExp, tStatus, jurisdiction]);

  // Overall completeness aggregates the three metrics' filled/total counts.
  const overallFilled = dossier.filled + findingsB.complete + deadlinesB.met;
  const overallTotal = dossier.total + findingsB.total + deadlinesB.total;
  const overallPct = ringPct(overallFilled, overallTotal);

  const ringTooltip = (w: DonutWedge): string =>
    w.meta.total > 0
      ? tRings('tooltip', { filled: w.meta.value, total: w.meta.total, pct: w.meta.pct })
      : tRings('tooltipNa');

  const ringAria = (w: DonutWedge): string =>
    tRings('ariaLabel', {
      label: w.label,
      value: w.meta.value,
      total: w.meta.total,
      pct: w.meta.pct,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <TooltipProvider delayDuration={150}>
        <DrilldownDonut
          wedges={wedges}
          overviewCenter={{ value: `${String(overallPct)}%`, label: tRings('overallLabel') }}
          title={tRings('title')}
          backLabel={tExp('back')}
          headerRight={
            <span className="rounded-full bg-surface-high px-2.5 py-1 text-caption font-semibold tabular-nums text-foreground-secondary">
              {overallFilled}/{overallTotal}
            </span>
          }
          reducedMotion={reducedMotion}
          ariaLabelFor={ringAria}
          renderWedgeHit={(w, hit) => (
            <Tooltip key={`tt-${w.key}`}>
              <TooltipTrigger asChild>{hit}</TooltipTrigger>
              <TooltipContent side="top">{ringTooltip(w)}</TooltipContent>
            </Tooltip>
          )}
        />
      </TooltipProvider>
    </div>
  );
}
