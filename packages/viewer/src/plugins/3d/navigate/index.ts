/**
 * Navigate plugin. A pointer tool that behaves exactly like the default
 * (select) tool for camera navigation — orbit/pan/zoom and pivot-rotate
 * stay fully active — but suppresses click-selection and hover-highlight.
 *
 * Camera navigation is independent of the active tool, so "navigate mode"
 * is just "select mode with the selection/hover mouse gestures removed".
 * On enter it suppresses the selection/hover mouse gestures (via the shared
 * `suppressSelectionGestures` helper) and rebinds them on exit. The selection
 * plugin's state and its painted highlights are never touched, so an existing
 * selection stays visible while navigating.
 */

import type { Plugin, ViewerContext } from '../../../core/types.js';
import { suppressSelectionGestures } from '../shared/suppressSelection.js';

const NAME = 'navigate' as const;

export interface NavigatePluginAPI {
  isActive(): boolean;
}

export function navigatePlugin(): Plugin & NavigatePluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let restore: (() => Promise<void>) | null = null;

  const enter = async (): Promise<void> => {
    if (!ctxRef || active) return;

    restore = await suppressSelectionGestures(ctxRef);

    active = true;
    ctxRef.events.emit('navigate:change', { active: true });
  };

  const exit = async (): Promise<void> => {
    if (!ctxRef || !active) return;

    await restore?.();
    restore = null;
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

      // navigate.enter/exit are internal plumbing for the tool-manager's
      // `action = none` state (suppress click-selection/hover); they carry no
      // keyboard shortcut of their own.
      ctx.commands.register('navigate.enter', () => enter(), {
        title: 'Activate navigate tool',
      });

      ctx.commands.register('navigate.exit', () => exit(), {
        title: 'Deactivate navigate tool',
      });

      ctx.commands.register('navigate.isActive', () => active, {
        title: 'Check if navigate tool is active',
      });
    },

    async uninstall() {
      if (active && ctxRef) {
        await exit();
      }
      ctxRef = null;
    },
  };
}
