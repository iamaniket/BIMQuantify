/**
 * PDF tools plugin. Owns the active pointer tool (select/pan/zoom/line) and the
 * presentation that follows from it: the container cursor and the page-canvas
 * pointer-events. Text selection is disabled in this viewer — the PDF text layer
 * is kept inert (no pointer events, not selectable) so a drag pans the camera
 * instead of selecting text. Other plugins (e.g. pan) ask it to refresh the
 * cursor after a transient override.
 */

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentTool,
} from '../../../pdf-core/documentTypes.js';

export interface ToolsPluginAPI {
  /** Re-apply the tool-derived cursor (used by pan after a drag ends). */
  refreshCursor(): void;
}

function cursorForTool(tool: DocumentTool): string {
  if (tool === 'pan') return 'grab';
  if (tool === 'zoom') return 'zoom-in';
  return 'default';
}

export function toolsPlugin(): DocumentPlugin & ToolsPluginAPI {
  let ctx: DocumentContext | null = null;
  const cleanups: Array<() => void> = [];

  function applyTool(): void {
    if (!ctx) return;
    const tool = ctx.getTool();
    ctx.container.style.cursor = cursorForTool(tool);
    // The 2D viewer is a navigation surface, not a text-reading one: never let a
    // drag select the PDF text layer — it fights camera panning (most visibly in
    // Split view, where the only nav is a mouse-drag). Keep the text layer inert;
    // search still highlights via its own DOM spans, which need neither pointer
    // events nor selection.
    ctx.container.style.userSelect = 'none';
    ctx.canvas.style.pointerEvents = tool === 'pan' ? 'none' : 'auto';
    ctx.textLayer.style.pointerEvents = 'none';
    ctx.textLayer.style.userSelect = 'none';
  }

  return {
    name: 'tools',

    refreshCursor(): void {
      if (ctx) ctx.container.style.cursor = cursorForTool(ctx.getTool());
    },

    install(context: DocumentContext): void {
      ctx = context;
      applyTool();
      cleanups.push(context.events.on('tool:change', applyTool));

      context.commands.register<{ tool: DocumentTool }>('tool.set', (args) => {
        context.setTool(args.tool);
      }, { title: 'Set tool' });
      context.commands.register('tool.select', () => { context.setTool('select'); }, {
        title: 'Select tool',
        defaultShortcut: 'V',
      });
      context.commands.register('tool.pan', () => { context.setTool('pan'); }, {
        title: 'Pan tool',
        defaultShortcut: 'H',
      });
      context.commands.register('tool.zoom', () => { context.setTool('zoom'); }, {
        title: 'Zoom tool',
        defaultShortcut: 'Z',
      });
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      ctx = null;
    },
  };
}
