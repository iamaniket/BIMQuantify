/**
 * Eraser plugin. When active, left-clicking any element hides it by
 * delegating to the visibility plugin. Swaps the `click:left` mouse
 * binding from `selection.pickSet` to `eraser.pickHide` on enter, and
 * restores it on exit.
 */

import { pick } from '../../../core/Raycaster.js';
import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'eraser' as const;

export interface EraserPluginAPI {
  isActive(): boolean;
}

export function eraserPlugin(): Plugin & EraserPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let savedBinding: string | null = null;

  const enter = async (): Promise<void> => {
    if (!ctxRef || active) return;

    const bindings = await ctxRef.commands.execute<undefined, Array<{ gesture: string; command: string }>>('mouseBindings.list');
    const current = bindings?.find((b) => b.gesture === 'click:left');
    savedBinding = current?.command ?? 'selection.pickSet';

    await ctxRef.commands.execute('mouseBindings.bind', { gesture: 'click:left', command: 'eraser.pickHide' });
    await ctxRef.commands.execute('selection.clear').catch(() => undefined);

    active = true;
    ctxRef.events.emit('eraser:change', { active: true });
  };

  const exit = async (): Promise<void> => {
    if (!ctxRef || !active) return;

    await ctxRef.commands.execute('mouseBindings.bind', {
      gesture: 'click:left',
      command: savedBinding ?? 'selection.pickSet',
    });

    active = false;
    savedBinding = null;
    ctxRef.events.emit('eraser:change', { active: false });
  };

  type PickArgs = { ndc?: { x: number; y: number } | null } | null | undefined;

  const pickHide = async (args: unknown): Promise<void> => {
    if (!ctxRef || !active) return;
    const a = args as PickArgs;
    const ndc = a?.ndc;
    if (!ndc) return;

    const hit = await pick(ctxRef, ndc);
    if (!hit) return;

    await ctxRef.commands.execute('visibility.hideItem', [hit.item]);
  };

  return {
    name: NAME,
    dependencies: ['visibility', 'mouse-bindings', 'selection'],

    isActive() {
      return active;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('eraser.pickHide', (args: unknown) => pickHide(args), {
        title: 'Hide element under cursor (eraser)',
      });

      ctx.commands.register('eraser.enter', () => enter(), {
        title: 'Activate eraser tool',
      });

      ctx.commands.register('eraser.exit', () => exit(), {
        title: 'Deactivate eraser tool',
      });

      // Shortcut '4' is owned by tool-manager's `tool.eraser`, which routes
      // through the active-tool authority; binding it here too would double-bind.
      ctx.commands.register('eraser.toggle', async () => {
        if (active) await exit();
        else await enter();
      }, { title: 'Toggle eraser tool' });

      ctx.commands.register('eraser.isActive', () => active, {
        title: 'Check if eraser is active',
      });
    },

    uninstall() {
      if (active && ctxRef) {
        void exit();
      }
      ctxRef = null;
    },
  };
}
