/**
 * PDF pan plugin. Drag-scrolls the page when the Pan tool is active (left
 * button) or the middle mouse button is held anywhere. Touch gestures are
 * owned by the zoom plugin (pinch), so this only handles mouse/pen pointers.
 * Ported from the old DocumentViewer pan-drag handlers.
 */

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';
import type { ToolsPluginAPI } from '../tools/index.js';

interface DragState {
  startX: number;
  startY: number;
  scrollLeft: number;
  scrollTop: number;
  pointerId: number;
}

export function pdfPanPlugin(): DocumentPlugin {
  let ctx: DocumentContext | null = null;
  let drag: DragState | null = null;
  const cleanups: Array<() => void> = [];

  function onPointerDown(ev: PointerEvent): void {
    if (!ctx || ev.pointerType === 'touch') return;
    const isMiddle = ev.button === 1;
    const isLeftPanTool = ev.button === 0 && ctx.getTool() === 'pan';
    if (!isMiddle && !isLeftPanTool) return;
    ev.preventDefault();
    const { container } = ctx;
    drag = {
      startX: ev.clientX,
      startY: ev.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      pointerId: ev.pointerId,
    };
    try {
      container.setPointerCapture(ev.pointerId);
    } catch {
      // capture is a hint — ignore failures
    }
    container.style.cursor = 'grabbing';
  }

  function onPointerMove(ev: PointerEvent): void {
    if (!ctx || ev.pointerType === 'touch' || drag === null) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    ctx.container.scrollLeft = drag.scrollLeft - dx;
    ctx.container.scrollTop = drag.scrollTop - dy;
  }

  function endDrag(ev: PointerEvent): void {
    if (!ctx || ev.pointerType === 'touch' || drag === null) return;
    try {
      ctx.container.releasePointerCapture(drag.pointerId);
    } catch {
      // ignore
    }
    drag = null;
    // Restore the tool-derived cursor (we overrode it with 'grabbing').
    ctx.plugins.get<ToolsPluginAPI>('tools')?.refreshCursor();
  }

  return {
    name: 'pan',
    dependencies: ['tools'],

    install(context: DocumentContext): void {
      ctx = context;
      const { container } = context;
      container.addEventListener('pointerdown', onPointerDown);
      container.addEventListener('pointermove', onPointerMove);
      container.addEventListener('pointerup', endDrag);
      container.addEventListener('pointercancel', endDrag);
      cleanups.push(() => {
        container.removeEventListener('pointerdown', onPointerDown);
        container.removeEventListener('pointermove', onPointerMove);
        container.removeEventListener('pointerup', endDrag);
        container.removeEventListener('pointercancel', endDrag);
      });
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      drag = null;
      ctx = null;
    },
  };
}
