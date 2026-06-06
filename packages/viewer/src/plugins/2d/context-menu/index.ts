/**
 * 2D context-menu plugin. Binds right-click on the document container to emit
 * `contextmenu:open` carrying the viewport-relative position and current page.
 * The actual menu UI lives in the host app (portal) — this plugin just
 * provides the data plumbing, mirroring the 3D `context-menu` plugin.
 */

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';

const NAME = 'context-menu' as const;

export function contextMenuPlugin(): DocumentPlugin {
  let ctx: DocumentContext | null = null;
  let isOpen = false;
  const cleanups: Array<() => void> = [];

  function close(): void {
    if (!ctx || !isOpen) return;
    isOpen = false;
    ctx.events.emit('contextmenu:close', undefined);
  }

  function onMouseDown(ev: MouseEvent): void {
    if (ev.button === 0 && isOpen) close();
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && isOpen) {
      ev.stopPropagation();
      close();
    }
  }

  return {
    name: NAME,

    install(context: DocumentContext): void {
      ctx = context;
      const { container } = context;

      container.addEventListener('mousedown', onMouseDown);
      container.addEventListener('keydown', onKeyDown, true);

      context.commands.register('contextMenu.open', (args: unknown) => {
        if (!ctx) return;
        const a = args as { containerX?: number; containerY?: number; page?: number } | undefined;
        isOpen = true;
        ctx.events.emit('contextmenu:open', {
          position: { x: a?.containerX ?? 0, y: a?.containerY ?? 0 },
          page: a?.page ?? ctx.getCurrentPage(),
        });
      }, { title: 'Open context menu' });
      context.commands.register('contextMenu.close', () => close(), {
        title: 'Close context menu',
      });

      cleanups.push(() => {
        container.removeEventListener('mousedown', onMouseDown);
        container.removeEventListener('keydown', onKeyDown, true);
      });
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      isOpen = false;
      ctx = null;
    },
  };
}
