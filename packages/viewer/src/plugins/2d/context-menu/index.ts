/**
 * 2D context-menu plugin. Binds right-click on the document container to emit
 * `contextmenu:open` carrying the viewport-relative position, current page,
 * and normalized page-space coordinates (0..1, top-left origin) for anchoring
 * attachments / findings / certificates to the clicked location.
 * The actual menu UI lives in the host app (portal) — this plugin just
 * provides the data plumbing, mirroring the 3D `context-menu` plugin.
 */

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';

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

  /**
   * Compute normalized page coordinates (0..1, top-left origin) from
   * container-relative pixel coordinates using the scene plugin's camera.
   */
  function computePagePoint(containerX: number, containerY: number): { x: number; y: number } | null {
    if (!ctx) return null;
    const sceneApi = ctx.plugins.get<SceneAPI>('scene');
    if (!sceneApi) return null;
    const unscaled = ctx.getUnscaledViewport();
    if (!unscaled) return null;
    // screenToWorld returns PDF-point world space (Y-up, origin at bottom-left).
    const world = sceneApi.screenToWorld(containerX, containerY);
    // Normalize to 0..1 with top-left origin (Y flipped).
    const nx = world.x / unscaled.width;
    const ny = 1 - (world.y / unscaled.height);
    // Clamp — if outside page bounds, still valid (user may have clicked margin).
    const x = Math.max(0, Math.min(1, nx));
    const y = Math.max(0, Math.min(1, ny));
    return { x, y };
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
    dependencies: ['scene'],

    install(context: DocumentContext): void {
      ctx = context;
      const { container } = context;

      container.addEventListener('mousedown', onMouseDown);
      container.addEventListener('keydown', onKeyDown, true);

      context.commands.register('contextMenu.open', (args: unknown) => {
        if (!ctx) return;
        const a = args as { containerX?: number; containerY?: number; page?: number } | undefined;
        const cX = a?.containerX ?? 0;
        const cY = a?.containerY ?? 0;
        isOpen = true;
        ctx.events.emit('contextmenu:open', {
          position: { x: cX, y: cY },
          page: a?.page ?? ctx.getCurrentPage(),
          pagePoint: computePagePoint(cX, cY),
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
