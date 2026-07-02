'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type JSX } from 'react';
import { createPortal } from 'react-dom';

import { DEMO_COLUMNS, DEMO_FINDINGS, type DemoFindingStatus } from './demoWorkflow';
import { useCardDrag } from './useCardDrag';
import { WorkflowDemoCard } from './WorkflowDemoCard';

// Column accents mirror the finding lifecycle tones used across the product.
const COLUMN_ACCENT: Record<DemoFindingStatus, string> = {
  open: 'var(--info)',
  in_progress: 'var(--primary)',
  resolved: 'var(--success)',
};

type Props = {
  statusById: Record<string, DemoFindingStatus>;
  onMove: (id: string, to: DemoFindingStatus) => void;
  /** Card that just landed a move (plays the drop pulse). */
  pulseId: string | null;
};

/** The move button walks the card one column forward, or back from the last. */
function moveTargetFor(
  status: DemoFindingStatus,
): { target: DemoFindingStatus; back: boolean } | null {
  const index = DEMO_COLUMNS.indexOf(status);
  const next = DEMO_COLUMNS[index + 1];
  if (next !== undefined) return { target: next, back: false };
  const previous = DEMO_COLUMNS[index - 1];
  if (previous !== undefined) return { target: previous, back: true };
  return null;
}

/**
 * Three fixed columns (styled after `@bimdossier/ui`'s KanbanColumn, but NOT
 * imported — that component needs `@dnd-kit`, a dependency web doesn't carry)
 * plus the bespoke pointer drag from `useCardDrag`. Horizontal snap scroll on
 * small screens, same idiom as the ui board.
 */
export function DemoBoard({ statusById, onMove, pulseId }: Props): JSX.Element {
  const t = useTranslations('workflowDemo');
  const { drag, ghostRef, startDrag, setColumnRef } = useCardDrag(onMove);

  // Keyboard continuity: a button-initiated move remounts the card in its new
  // column (focus would drop to <body>), so refocus the re-labelled move
  // button once the new arrangement has rendered.
  const moveButtonEls = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusId = useRef<string | null>(null);
  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) return;
    pendingFocusId.current = null;
    moveButtonEls.current.get(id)?.focus();
  }, [statusById]);

  const ghostFinding =
    drag === null ? undefined : DEMO_FINDINGS.find((finding) => finding.id === drag.id);

  return (
    <div
      role="group"
      aria-label={t('board.ariaLabel')}
      className="flex snap-x gap-4 overflow-x-auto pb-2"
    >
      {DEMO_COLUMNS.map((status) => {
        const findings = DEMO_FINDINGS.filter(
          (finding) => (statusById[finding.id] ?? finding.initialStatus) === status,
        );
        const highlighted = drag !== null && drag.over === status && drag.from !== status;
        const move = moveTargetFor(status);
        return (
          <div
            key={status}
            className="flex min-w-[240px] flex-1 snap-start flex-col rounded-lg border border-border bg-surface-low"
          >
            <div
              className="rounded-t-lg border-b border-border px-3 py-2.5"
              style={{ borderTop: `3px solid ${COLUMN_ACCENT[status]}` }}
            >
              <div className="flex items-center justify-between">
                <span className="text-body3 font-semibold text-foreground">
                  {t(`columns.${status}`)}
                </span>
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-background px-1.5 text-caption font-bold tabular-nums text-foreground-tertiary">
                  {findings.length}
                </span>
              </div>
            </div>

            <div
              ref={setColumnRef(status)}
              className={`flex min-h-[160px] flex-1 flex-col gap-2 p-2 transition-colors ${
                highlighted ? 'bg-primary-lighter/30' : ''
              }`}
            >
              {findings.map((finding) => (
                <WorkflowDemoCard
                  key={finding.id}
                  finding={finding}
                  moveTarget={move?.target ?? null}
                  moveIsBack={move?.back ?? false}
                  onMove={(to) => {
                    pendingFocusId.current = finding.id;
                    onMove(finding.id, to);
                  }}
                  moveButtonRef={(el) => {
                    if (el === null) moveButtonEls.current.delete(finding.id);
                    else moveButtonEls.current.set(finding.id, el);
                  }}
                  onPointerDown={startDrag(finding.id, status)}
                  dimmed={drag?.id === finding.id}
                  pulsing={pulseId === finding.id}
                />
              ))}
              {findings.length === 0 && (
                <div className="flex flex-1 items-center justify-center">
                  <span className="text-caption text-foreground-tertiary">{t('board.empty')}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Drag ghost — portaled to <body> because the board sits inside a
          Reveal wrapper whose transform would turn `fixed` into
          container-relative positioning. Position updates go straight to the
          element's transform in useCardDrag (no re-render per pointermove). */}
      {drag !== null && ghostFinding !== undefined
        ? createPortal(
            <div aria-hidden className="pointer-events-none fixed inset-0 z-50">
              <div
                ref={ghostRef}
                className="absolute left-0 top-0 will-change-transform"
                style={{
                  width: drag.width,
                  transform: `translate(${String(drag.x)}px, ${String(drag.y)}px)`,
                }}
              >
                <WorkflowDemoCard finding={ghostFinding} moveTarget={null} ghost />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
