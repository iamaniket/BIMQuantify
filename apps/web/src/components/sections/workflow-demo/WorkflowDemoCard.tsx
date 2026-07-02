'use client';

import { Camera, ChevronLeft, ChevronRight } from '@bimdossier/ui/icons';
import { useTranslations } from 'next-intl';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';

import type { DemoFinding, DemoFindingStatus, DemoSeverity } from './demoWorkflow';

// Same severity→tone mapping as the snag showcase (SnagShowcaseSection.tsx).
const SEVERITY_DOT: Record<DemoSeverity, string> = {
  high: 'bg-error',
  medium: 'bg-warning',
  low: 'bg-info',
};

type Props = {
  finding: DemoFinding;
  /** One-column move target for the real `<button>`; null renders no button (ghost). */
  moveTarget: DemoFindingStatus | null;
  /** True when the button retreats (resolved cards) — flips label + chevron. */
  moveIsBack?: boolean;
  onMove?: (to: DemoFindingStatus) => void;
  /** Registers the move button so the board can restore focus after a move. */
  moveButtonRef?: (el: HTMLButtonElement | null) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** The in-column original while its ghost is being dragged. */
  dimmed?: boolean;
  /** Brief success ring right after a drop (motion-gated in globals.css). */
  pulsing?: boolean;
  /** Render as the floating drag ghost (decorative, non-interactive). */
  ghost?: boolean;
};

/**
 * Marketing finding card for the demo board. Deliberately NOT the portal's
 * FindingKanbanCard (which drags in UserAvatar/BlueprintTexture/date libs).
 * The card body is a plain div — drag is a pointer enhancement, so it gets no
 * fake `role="button"`; the move `<button>` below is the canonical keyboard /
 * touch / screen-reader action.
 */
export function WorkflowDemoCard({
  finding,
  moveTarget,
  moveIsBack = false,
  onMove,
  moveButtonRef,
  onPointerDown,
  dimmed = false,
  pulsing = false,
  ghost = false,
}: Props): JSX.Element {
  const t = useTranslations('workflowDemo');
  const title = t(`findings.${finding.titleKey}`);
  const columnLabel = moveTarget === null ? null : t(`columns.${moveTarget}`);

  return (
    <div
      onPointerDown={onPointerDown}
      className={[
        'group select-none touch-pan-y rounded-lg border border-border bg-surface-main p-3',
        ghost
          ? 'pointer-events-none rotate-1 shadow-card-hover'
          : 'cursor-grab shadow-card active:cursor-grabbing',
        dimmed ? 'opacity-40' : '',
        pulsing ? 'animate-demo-drop' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-low px-2 py-0.5 text-caption font-medium text-foreground-secondary">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`}
          />
          {t(`severity.${finding.severity}`)}
        </span>
        <span
          aria-hidden
          className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-primary-lighter px-1 text-micro font-bold text-primary"
        >
          {finding.assigneeInitials}
        </span>
      </div>

      <p className="mt-2 text-body3 font-medium text-foreground">{title}</p>

      <div className="mt-2 flex items-center gap-2">
        {finding.bblArticleRef !== null && (
          <span className="rounded bg-primary-lighter px-1.5 py-0.5 text-caption font-medium text-primary">
            {t('card.bbl', { article: finding.bblArticleRef })}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-caption text-foreground-tertiary">
          <Camera aria-hidden className="h-3 w-3" />
          <span aria-hidden>{finding.photoCount}</span>
          <span className="sr-only">{t('card.photos', { count: finding.photoCount })}</span>
        </span>
        <span className="ml-auto truncate text-caption text-foreground-tertiary">
          {t(`disciplines.${finding.discipline}`)}
        </span>
      </div>

      {moveTarget !== null && columnLabel !== null && (
        <button
          type="button"
          ref={moveButtonRef}
          onClick={() => onMove?.(moveTarget)}
          aria-label={t(moveIsBack ? 'card.moveBack' : 'card.moveNext', {
            title,
            column: columnLabel,
          })}
          className="workflow-demo-move mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-border bg-surface-low px-2 py-1 text-caption font-medium text-foreground-secondary opacity-0 transition-[opacity,background-color] duration-fast hover:bg-background-hover focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none"
        >
          {moveIsBack && <ChevronLeft aria-hidden className="h-3 w-3" />}
          {t(moveIsBack ? 'card.backTo' : 'card.moveTo', { column: columnLabel })}
          {!moveIsBack && <ChevronRight aria-hidden className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
