'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

import { DEMO_COLUMNS, type DemoFindingStatus } from './demoWorkflow';

/** Pointer travel (px) before a press becomes a drag — under it, it's a tap/click. */
const DRAG_THRESHOLD_PX = 6;

export type CardDragState = {
  /** The finding being dragged. */
  id: string;
  /** Column the drag started from. */
  from: DemoFindingStatus;
  /** Ghost geometry at activation, in viewport px. */
  width: number;
  x: number;
  y: number;
  /** Column currently under the pointer. */
  over: DemoFindingStatus | null;
};

type DragSession = {
  id: string;
  from: DemoFindingStatus;
  pointerId: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  width: number;
  active: boolean;
  /** Column drop zones, cached once when the drag activates. */
  rects: { status: DemoFindingStatus; rect: DOMRect }[];
  over: DemoFindingStatus | null;
};

type UseCardDragResult = {
  /** Non-null while a drag is active (past the threshold). */
  drag: CardDragState | null;
  /** Attach to the ghost wrapper — pointermove drives its transform directly. */
  ghostRef: RefObject<HTMLDivElement | null>;
  /** Build the card's `onPointerDown` handler. */
  startDrag: (
    id: string,
    from: DemoFindingStatus,
  ) => (event: ReactPointerEvent<HTMLDivElement>) => void;
  /** Build a column body's ref callback (registers its drop zone). */
  setColumnRef: (status: DemoFindingStatus) => (el: HTMLDivElement | null) => void;
};

/**
 * Bespoke pointer drag for the workflow-demo board — deliberately NOT
 * `@dnd-kit` (a new dependency for one fixed 3-column interaction, with no
 * keyboard path; see the design notes). The real `<button>` on every card is
 * the canonical move action; this drag is a pointer-only enhancement.
 *
 * Mechanics: 6px activation threshold, pointer capture on the source card,
 * ghost positioned imperatively per pointermove (no re-render per frame),
 * column rects cached at activation, `Escape`/`pointercancel` aborts. Cards
 * should set `touch-action: pan-y` so vertical page scroll survives on touch
 * while horizontal drags reach us.
 */
export function useCardDrag(
  onDrop: (id: string, to: DemoFindingStatus) => void,
): UseCardDragResult {
  const [drag, setDrag] = useState<CardDragState | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const columnEls = useRef(new Map<DemoFindingStatus, HTMLDivElement>());
  const session = useRef<DragSession | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    onDropRef.current = onDrop;
  }, [onDrop]);

  // Safety net: if the board unmounts mid-drag, tear the listeners down.
  const abortActive = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      abortActive.current?.();
    },
    [],
  );

  const setColumnRef = useCallback(
    (status: DemoFindingStatus) =>
      (el: HTMLDivElement | null): void => {
        if (el === null) columnEls.current.delete(status);
        else columnEls.current.set(status, el);
      },
    [],
  );

  const startDrag = useCallback(
    (id: string, from: DemoFindingStatus) =>
      (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (session.current !== null) return; // one drag at a time
        if (!event.isPrimary || event.button !== 0) return;
        // The move <button> is the canonical action — never hijack its press.
        if (event.target instanceof Element && event.target.closest('button') !== null) return;

        const cardEl = event.currentTarget;
        const rect = cardEl.getBoundingClientRect();
        const s: DragSession = {
          id,
          from,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          width: rect.width,
          active: false,
          rects: [],
          over: null,
        };
        session.current = s;

        const hitTest = (x: number, y: number): DemoFindingStatus | null => {
          for (const zone of s.rects) {
            const r = zone.rect;
            if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zone.status;
          }
          return null;
        };

        const finish = (commit: boolean): void => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
          window.removeEventListener('keydown', onKey);
          abortActive.current = null;
          try {
            cardEl.releasePointerCapture(s.pointerId);
          } catch {
            // Capture was never taken (below-threshold press) — fine.
          }
          const dropTarget =
            commit && s.active && s.over !== null && s.over !== s.from ? s.over : null;
          session.current = null;
          setDrag(null);
          if (dropTarget !== null) onDropRef.current(s.id, dropTarget);
        };

        const onMove = (ev: PointerEvent): void => {
          if (ev.pointerId !== s.pointerId) return;
          if (!s.active) {
            if (Math.hypot(ev.clientX - s.startX, ev.clientY - s.startY) < DRAG_THRESHOLD_PX) {
              return;
            }
            s.active = true;
            try {
              cardEl.setPointerCapture(s.pointerId);
            } catch {
              // Pointer already gone (e.g. released this frame) — abort quietly.
            }
            s.rects = DEMO_COLUMNS.flatMap((status) => {
              const el = columnEls.current.get(status);
              return el ? [{ status, rect: el.getBoundingClientRect() }] : [];
            });
          }
          const x = ev.clientX - s.offsetX;
          const y = ev.clientY - s.offsetY;
          // Move the ghost imperatively — a state update per pointermove would
          // re-render the whole board at pointer frequency.
          if (ghostRef.current !== null) {
            ghostRef.current.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
          }
          const over = hitTest(ev.clientX, ev.clientY);
          s.over = over;
          setDrag((prev) => {
            if (prev === null) return { id: s.id, from: s.from, width: s.width, x, y, over };
            if (prev.over === over) return prev;
            // Refresh x/y alongside `over` so the re-render doesn't reapply a
            // stale transform over the imperatively-moved ghost.
            return { ...prev, over, x, y };
          });
        };

        const onUp = (ev: PointerEvent): void => {
          if (ev.pointerId === s.pointerId) finish(true);
        };
        const onCancel = (ev: PointerEvent): void => {
          if (ev.pointerId === s.pointerId) finish(false);
        };
        const onKey = (ev: KeyboardEvent): void => {
          if (ev.key === 'Escape') finish(false);
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey);
        abortActive.current = () => finish(false);
      },
    [],
  );

  return { drag, ghostRef, startDrag, setColumnRef };
}
