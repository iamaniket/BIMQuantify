/**
 * PDF tools plugin. Owns the active pointer tool (select/pan/zoom/line) and the
 * presentation that follows from it: the container cursor, page-canvas and
 * text-layer pointer-events, and text selection. Other plugins (e.g. pan) ask
 * it to refresh the cursor after a transient override.
 */

import type {
  DocumentContext,
  DocumentPlugin,
  PdfTool,
} from '../../../pdf-core/documentTypes.js';

export interface ToolsPluginAPI {
  /** Re-apply the tool-derived cursor (used by pan after a drag ends). */
  refreshCursor(): void;
}

function cursorForTool(tool: PdfTool): string {
  if (tool === 'pan') return 'grab';
  if (tool === 'zoom') return 'zoom-in';
  return 'default';
}

export function pdfToolsPlugin(): DocumentPlugin & ToolsPluginAPI {
  let ctx: DocumentContext | null = null;
  const cleanups: Array<() => void> = [];

  function applyTool(): void {
    if (!ctx) return;
    const tool = ctx.getTool();
    ctx.container.style.cursor = cursorForTool(tool);
    ctx.container.style.userSelect = tool === 'pan' ? 'none' : 'auto';
    ctx.canvas.style.pointerEvents = tool === 'pan' ? 'none' : 'auto';
    ctx.textLayer.style.pointerEvents = tool === 'select' ? 'auto' : 'none';
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

      context.commands.register<{ tool: PdfTool }>('tool.set', (args) => {
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
