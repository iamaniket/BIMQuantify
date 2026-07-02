'use client';

import { Button } from '@bimdossier/ui';
import { RotateCcw } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type JSX } from 'react';

import { Reveal } from '@/components/shared/Reveal';
import { SectionHeading } from '@/components/shared/SectionHeading';
import { useInView } from '@/hooks/useInView';
import { useReducedMotion } from '@/hooks/useReducedMotion';

import { DemoBoard } from './workflow-demo/DemoBoard';
import { DemoDashboard } from './workflow-demo/DemoDashboard';
import { DemoProjectHeader } from './workflow-demo/DemoProjectHeader';
import {
  DEMO_DASHBOARD,
  DEMO_FINDINGS,
  initialStatusById,
  type DemoDiscipline,
  type DemoFindingStatus,
} from './workflow-demo/demoWorkflow';

/**
 * "Touch the product" set piece: a live findings board wired to a demo-project
 * dashboard. One shared state — drag (or button-move) a finding into Resolved
 * and the open-findings KPI counts down, dossier completeness ticks up, the
 * donut re-sweeps and the discipline bar shrinks. Everything on screen is one
 * demo project's numbers (the rail carries a "demo data" chip), never company
 * metrics.
 */
export function WorkflowDemoSection(): JSX.Element {
  const t = useTranslations('workflowDemo');
  const reducedMotion = useReducedMotion();
  // Gates the reveal choreography (count-ups, donut sweep, bar grow). Reduced
  // motion skips straight to final values, so it never waits on the observer.
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '0px 0px -15% 0px' });
  const drawn = inView || reducedMotion;

  const [statusById, setStatusById] = useState<Record<string, DemoFindingStatus>>(
    initialStatusById,
  );
  const [statusLine, setStatusLine] = useState('');
  const [pulseId, setPulseId] = useState<string | null>(null);

  // One shared state, many read models: every KPI/chart value derives from
  // the board arrangement. "Open" here means not yet resolved — a finding in
  // progress is still open work.
  const derived = useMemo(() => {
    let resolved = 0;
    let pending = 0;
    let open = 0;
    const disciplineCounts: Record<DemoDiscipline, number> = {
      structure: 0,
      installations: 0,
      finishing: 0,
      facade: 0,
    };
    for (const finding of DEMO_FINDINGS) {
      const status = statusById[finding.id] ?? finding.initialStatus;
      if (status === 'resolved') {
        resolved += 1;
        continue;
      }
      if (status === 'in_progress') pending += 1;
      else open += 1;
      disciplineCounts[finding.discipline] += 1;
    }
    const complete = DEMO_DASHBOARD.dossierItemsComplete + resolved;
    return {
      openFindings: open + pending,
      dossierReadyPct: Math.round((complete / DEMO_DASHBOARD.dossierItemsTotal) * 100),
      donut: { complete, pending, missing: open },
      disciplineCounts,
    };
  }, [statusById]);

  const diverged = DEMO_FINDINGS.some(
    (finding) => (statusById[finding.id] ?? finding.initialStatus) !== finding.initialStatus,
  );

  function moveFinding(id: string, to: DemoFindingStatus): void {
    setStatusById((prev) => (prev[id] === to ? prev : { ...prev, [id]: to }));
    setStatusLine(t('status.moved', { column: t(`columns.${to}`) }));
    setPulseId(id);
  }

  function resetDemo(): void {
    setStatusById(initialStatusById());
    setStatusLine(t('status.reset'));
    setPulseId(null);
  }

  // Let the drop pulse play once, then clear so the next drop replays it.
  useEffect(() => {
    if (pulseId === null) return undefined;
    const timer = setTimeout(() => setPulseId(null), 700);
    return () => clearTimeout(timer);
  }, [pulseId]);

  return (
    <section id="workflow-demo" className="mx-auto w-full max-w-8xl px-6 py-20">
      <div ref={ref}>
        <SectionHeading
          eyebrow={t('eyebrow')}
          headline={t('headline')}
          subtitle={t('subtitle')}
          className="mb-6"
        />

        {/* Hint + reset. The reset button holds its space and fades in once the
            board diverges; `focus:` keeps it visible while focused so pressing
            it never dumps focus onto a vanished control. */}
        <div className="mb-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
          <p className="flex items-center gap-2 text-body2 text-foreground-secondary">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
            {t('hintDrag')}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={resetDemo}
            tabIndex={diverged ? 0 : -1}
            className={`transition-opacity motion-reduce:transition-none ${
              diverged
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 focus:pointer-events-auto focus:opacity-100'
            }`}
          >
            <RotateCcw aria-hidden className="h-3.5 w-3.5" />
            {t('reset')}
          </Button>
        </div>

        <Reveal>
          <DemoProjectHeader />
        </Reveal>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Reveal delay={80} className="lg:col-span-2">
            <DemoBoard statusById={statusById} onMove={moveFinding} pulseId={pulseId} />
          </Reveal>
          <Reveal delay={160}>
            <DemoDashboard
              drawn={drawn}
              dossierReadyPct={derived.dossierReadyPct}
              openFindings={derived.openFindings}
              donut={derived.donut}
              disciplineCounts={derived.disciplineCounts}
            />
          </Reveal>
        </div>

        {/* Announces moves and reset to assistive tech; doubles as a quiet
            visual echo of the last action. min-h keeps the layout steady. */}
        <p aria-live="polite" className="mt-4 min-h-5 text-center text-body3 text-foreground-tertiary">
          {statusLine}
        </p>
      </div>
    </section>
  );
}
