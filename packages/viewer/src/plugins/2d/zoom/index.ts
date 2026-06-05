/**
 * PDF zoom plugin. Owns every way the page scale can change — toolbar/keyboard
 * commands, Ctrl/Meta + wheel toward the cursor, two-finger pinch, the click
 * zoom tool, double-click fit — plus the scroll-preserving math that keeps the
 * point under the cursor stable. Logic ported verbatim from the old monolithic
 * DocumentViewer.
 */

import {
  clampScale,
  type DocumentContext,
  type DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';

const SCALE_STEP = 0.25;
const FIT_PADDING = 24; // px of breathing room around the page when fitting.

type Origin = { x: number; y: number };

export function zoomPlugin(): DocumentPlugin {
  let ctx: DocumentContext | null = null;
  let pendingScroll: { scale: number; left: number; top: number } | null = null;
  const touchPoints = new Map<number, { x: number; y: number }>();
  let pinch: { startDistance: number; startScale: number } | null = null;
  const cleanups: Array<() => void> = [];

  /** Apply a new scale, recording the scroll that keeps `origin` stable. */
  function applyScaleAtOrigin(target: number, origin?: Origin): void {
    if (!ctx) return;
    const { container, canvas } = ctx;
    const clamped = clampScale(target);
    const current = ctx.getScale();
    if (clamped === current) return;

    if (origin) {
      const rect = canvas.getBoundingClientRect();
      const xOnCanvas = origin.x - rect.left;
      const yOnCanvas = origin.y - rect.top;
      const ratio = clamped / current;
      const cRect = container.getBoundingClientRect();
      const cursorInContainerX = origin.x - cRect.left;
      const cursorInContainerY = origin.y - cRect.top;
      pendingScroll = {
        scale: clamped,
        left: xOnCanvas * ratio - cursorInContainerX + canvas.offsetLeft * ratio,
        top: yOnCanvas * ratio - cursorInContainerY + canvas.offsetTop * ratio,
      };
    }
    ctx.setScale(clamped);
  }

  function fit(mode: 'page' | 'width'): void {
    if (!ctx) return;
    const { container } = ctx;
    const unscaled = ctx.getUnscaledViewport();
    if (!unscaled) return;
    const availW = Math.max(1, container.clientWidth - FIT_PADDING * 2);
    const availH = Math.max(1, container.clientHeight - FIT_PADDING * 2);
    const sx = availW / unscaled.width;
    const sy = availH / unscaled.height;
    const next = mode === 'page' ? Math.min(sx, sy) : sx;
    ctx.setScale(clampScale(next));
  }

  function onWheel(ev: WheelEvent): void {
    if (!ctx) return;
    if (!(ev.ctrlKey || ev.metaKey)) return;
    ev.preventDefault();
    const factor = Math.exp(-ev.deltaY * 0.0015);
    applyScaleAtOrigin(ctx.getScale() * factor, { x: ev.clientX, y: ev.clientY });
  }

  function onClick(ev: MouseEvent): void {
    if (!ctx || ctx.getTool() !== 'zoom') return;
    const out = ev.altKey;
    const factor = out ? 1 / 1.25 : 1.25;
    applyScaleAtOrigin(ctx.getScale() * factor, { x: ev.clientX, y: ev.clientY });
  }

  function onContextMenu(ev: MouseEvent): void {
    if (ctx?.getTool() === 'zoom') ev.preventDefault();
  }

  function onDoubleClick(): void {
    const tool = ctx?.getTool();
    if (tool === 'pan' || tool === 'zoom') fit('page');
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' || !ctx) return;
    touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (touchPoints.size === 2) {
      const [a, b] = [...touchPoints.values()];
      if (a !== undefined && b !== undefined) {
        pinch = {
          startDistance: Math.hypot(b.x - a.x, b.y - a.y),
          startScale: ctx.getScale(),
        };
      }
    }
  }

  function onPointerMove(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch' || !touchPoints.has(ev.pointerId)) return;
    touchPoints.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch !== null && touchPoints.size >= 2) {
      const [a, b] = [...touchPoints.values()];
      if (a !== undefined && b !== undefined) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist > 0 && pinch.startDistance > 0) {
          const next = clampScale(pinch.startScale * (dist / pinch.startDistance));
          applyScaleAtOrigin(next, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
    }
  }

  function onPointerUp(ev: PointerEvent): void {
    if (ev.pointerType !== 'touch') return;
    touchPoints.delete(ev.pointerId);
    if (touchPoints.size < 2) pinch = null;
  }

  return {
    name: 'zoom',

    install(context: DocumentContext): void {
      ctx = context;
      const { container, commands, events } = context;

      // Native, non-passive wheel listener so preventDefault works for the
      // Ctrl/trackpad-pinch zoom gesture.
      container.addEventListener('wheel', onWheel, { passive: false });
      container.addEventListener('click', onClick);
      container.addEventListener('contextmenu', onContextMenu);
      container.addEventListener('dblclick', onDoubleClick);
      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', onPointerUp);
      container.addEventListener('pointercancel', onPointerUp);
      cleanups.push(() => {
        container.removeEventListener('wheel', onWheel);
        container.removeEventListener('click', onClick);
        container.removeEventListener('contextmenu', onContextMenu);
        container.removeEventListener('dblclick', onDoubleClick);
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', onPointerUp);
        container.removeEventListener('pointercancel', onPointerUp);
      });

      // Apply the scroll computed for a zoom origin once the new scale has
      // rendered (canvas is resized by then).
      const off = events.on('page:rendered', ({ scale }) => {
        if (pendingScroll === null || pendingScroll.scale !== scale) return;
        context.container.scrollLeft = pendingScroll.left;
        context.container.scrollTop = pendingScroll.top;
        pendingScroll = null;
      });
      cleanups.push(off);

      commands.register('zoom.in', () => { applyScaleAtOrigin(context.getScale() + SCALE_STEP); }, {
        title: 'Zoom in',
        defaultShortcut: '+',
      });
      commands.register('zoom.out', () => { applyScaleAtOrigin(context.getScale() - SCALE_STEP); }, {
        title: 'Zoom out',
        defaultShortcut: '-',
      });
      commands.register<{ scale: number; origin?: Origin }>('zoom.to', (args) => {
        applyScaleAtOrigin(args.scale, args.origin);
      }, { title: 'Zoom to' });
      commands.register('zoom.fitPage', () => { fit('page'); }, {
        title: 'Fit page',
        defaultShortcut: '0',
      });
      commands.register('zoom.fitWidth', () => { fit('width'); }, {
        title: 'Fit width',
        defaultShortcut: 'W',
      });
      commands.register('zoom.actualSize', () => { applyScaleAtOrigin(1); }, {
        title: 'Actual size',
        defaultShortcut: '1',
      });
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      touchPoints.clear();
      pinch = null;
      pendingScroll = null;
      ctx = null;
    },
  };
}
