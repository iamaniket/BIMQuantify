/**
 * Context-menu plugin. Binds right-click to raycast + emit a
 * `contextmenu:open` event carrying position and the picked item.
 * The actual menu UI lives in the host app (portal) — this plugin
 * just provides the data plumbing.
 */

import { pick } from '../../core/Raycaster.js';
import type { Plugin, ViewerContext, ViewerEvents } from '../../core/types.js';

const NAME = 'context-menu' as const;

export function contextMenuPlugin(): Plugin {
  let ctxRef: ViewerContext | null = null;
  let isOpen = false;

  // Stash the last right-click client coords from pointer:click so the
  // command handler (which only receives NDC) can emit pixel positions.
  let lastRightClickClient: { x: number; y: number } | null = null;
  let offPointerClick: (() => void) | null = null;
  let offLeftClick: (() => void) | null = null;

  const close = (): void => {
    if (!ctxRef || !isOpen) return;
    isOpen = false;
    ctxRef.events.emit('contextmenu:close', undefined);
  };

  const open = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;

    const a = args as { ndc?: { x: number; y: number } } | undefined;
    const ndc = a?.ndc;
    if (!ndc) return;

    const hit = await pick(ctxRef, ndc);

    const containerRect = ctxRef.container.getBoundingClientRect();
    let x = 0;
    let y = 0;
    if (lastRightClickClient) {
      x = lastRightClickClient.x - containerRect.left;
      y = lastRightClickClient.y - containerRect.top;
    }

    isOpen = true;
    ctxRef.events.emit('contextmenu:open', {
      position: { x, y },
      item: hit?.item ?? null,
      point: hit?.point ?? null,
    });
  };

  const onPointerClick = (ev: ViewerEvents['pointer:click']): void => {
    if (ev.button === 2) {
      lastRightClickClient = { x: ev.clientX, y: ev.clientY };
    }
  };

  const onLeftClick = (ev: ViewerEvents['pointer:click']): void => {
    if (ev.button === 0 && isOpen) {
      close();
    }
  };

  // Intercept Escape when the menu is open so it closes the menu
  // instead of clearing the selection.
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && isOpen) {
      ev.stopPropagation();
      close();
    }
  };

  return {
    name: NAME,
    dependencies: ['mouse-bindings'],

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      offPointerClick = ctx.events.on('pointer:click', onPointerClick);
      offLeftClick = ctx.events.on('pointer:click', onLeftClick);

      ctx.container.addEventListener('keydown', onKeyDown, true);
      window.addEventListener('keydown', onKeyDown, true);

      ctx.commands.register('contextMenu.open', (a: unknown) => open(a), {
        title: 'Open context menu',
      });

      ctx.commands.register('contextMenu.close', () => close(), {
        title: 'Close context menu',
      });

      ctx.commands.execute('mouseBindings.bind', {
        gesture: 'click:right',
        command: 'contextMenu.open',
      }).catch(() => undefined);
    },

    uninstall() {
      if (ctxRef) {
        ctxRef.container.removeEventListener('keydown', onKeyDown, true);
      }
      window.removeEventListener('keydown', onKeyDown, true);
      offPointerClick?.();
      offLeftClick?.();
      offPointerClick = null;
      offLeftClick = null;
      isOpen = false;
      ctxRef = null;
    },
  };
}
