/**
 * Navigate plugin. A pointer tool that behaves exactly like the default
 * (select) tool for camera navigation — orbit/pan/zoom and pivot-rotate
 * stay fully active — but suppresses click-selection and hover-highlight.
 *
 * Camera navigation is independent of the active tool, so "navigate mode"
 * is just "select mode with the selection/hover mouse gestures removed".
 * On enter, it unbinds every gesture wired to `selection.pick*` /
 * `hover.pick` / `hover.clear` (capturing them first); on exit, it rebinds
 * them. The selection plugin's state and its painted highlights are never
 * touched, so an existing selection stays visible while navigating.
 */

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'navigate' as const;

const isSuppressed = (command: string): boolean =>
  command.startsWith('selection.pick') ||
  command === 'hover.pick' ||
  command === 'hover.clear';

export interface NavigatePluginAPI {
  isActive(): boolean;
}

export function navigatePlugin(): Plugin & NavigatePluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let saved: Array<{ gesture: string; command: string }> = [];

  const enter = async (): Promise<void> => {
    if (!ctxRef || active) return;

    const bindings =
      (await ctxRef.commands.execute<undefined, Array<{ gesture: string; command: string }>>(
        'mouseBindings.list',
      )) ?? [];
    saved = bindings.filter((b) => isSuppressed(b.command));

    for (const b of saved) {
      await ctxRef.commands.execute('mouseBindings.unbind', { gesture: b.gesture });
    }

    // Drop any lingering hover paint so nothing stays highlighted.
    await ctxRef.commands.execute('hover.clear').catch(() => undefined);

    active = true;
    ctxRef.events.emit('navigate:change', { active: true });
  };

  const exit = async (): Promise<void> => {
    if (!ctxRef || !active) return;

    for (const b of saved) {
      await ctxRef.commands.execute('mouseBindings.bind', {
        gesture: b.gesture,
        command: b.command,
      });
    }

    saved = [];
    active = false;
    ctxRef.events.emit('navigate:change', { active: false });
  };

  return {
    name: NAME,
    dependencies: ['mouse-bindings'],

    isActive() {
      return active;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('navigate.enter', () => enter(), {
        title: 'Activate navigate tool',
        defaultShortcut: '3',
      });

      ctx.commands.register('navigate.exit', () => exit(), {
        title: 'Deactivate navigate tool',
      });

      ctx.commands.register('navigate.isActive', () => active, {
        title: 'Check if navigate tool is active',
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
