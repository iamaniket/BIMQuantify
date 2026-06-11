/**
 * Tool-manager plugin — the single authority over which pointer/camera tool is
 * active. The four tools (select, navigate, eraser, fly) each affect the camera
 * or the click gesture, so at most one may be active at a time.
 *
 * `select` is the fallback: whenever a tool is toggled off the manager returns
 * to it. Switching tools always exits the previous one before entering the next,
 * so enabling fly while navigate is on exits navigate, etc.
 *
 * Entry points:
 *   - `tool.set { tool }` — programmatic / toolbar dispatch.
 *   - `tool.select` / `tool.navigate` / `tool.eraser` / `tool.fly` — zero-arg
 *     commands carrying keyboard shortcuts (2/3/4) so `keyboard-shortcuts` can
 *     bind them. `tool.navigate` / `tool.eraser` / `tool.fly` toggle back to
 *     `select` when already active.
 *
 * As a safety net it also listens to `navigate:change` / `eraser:change` so the
 * manager stays correct even if a sub-tool is ever driven directly (bypassing
 * `tool.set`).
 */

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'tool-manager' as const;

export type ToolName = 'select' | 'navigate' | 'eraser' | 'fly';

const TOOLS: readonly ToolName[] = ['select', 'navigate', 'eraser', 'fly'];

function isToolName(value: unknown): value is ToolName {
  return typeof value === 'string' && (TOOLS as readonly string[]).includes(value);
}

export interface ToolManagerPluginAPI {
  getTool(): ToolName;
}

export function toolManagerPlugin(): Plugin & ToolManagerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let activeTool: ToolName = 'select';
  // Guard so manager-initiated enter/exit (which re-emit navigate:change /
  // eraser:change) don't recurse back through the reconcile listeners.
  let switching = false;
  const disposers: Array<() => void> = [];

  const exec = (command: string, args?: unknown): Promise<void> =>
    ctxRef?.commands.execute<unknown, void>(command, args).catch(() => undefined) ??
    Promise.resolve();

  /** Turn off whichever tool the given one isn't — defensive, idempotent. */
  const exitAllExcept = async (keep: ToolName): Promise<void> => {
    await Promise.all([
      keep !== 'navigate' ? exec('navigate.exit') : Promise.resolve(),
      keep !== 'eraser' ? exec('eraser.exit') : Promise.resolve(),
      keep !== 'fly' ? exec('cameraFly.disable') : Promise.resolve(),
    ]);
  };

  const setTool = async (next: ToolName): Promise<void> => {
    if (!ctxRef || next === activeTool || switching) return;
    switching = true;
    try {
      // Fully exit everything that isn't the target BEFORE entering it. navigate
      // and eraser both rewrite the `click:left` mouse binding, so a fire-and-
      // forget exit could race the new tool's enter and clobber the binding.
      await exitAllExcept(next);
      switch (next) {
        case 'navigate':
          await exec('navigate.enter');
          break;
        case 'eraser':
          await exec('eraser.enter');
          break;
        case 'fly':
          await exec('cameraFly.enable');
          break;
        case 'select':
          // select == no active tool; exitAllExcept already cleared the rest.
          break;
      }
      activeTool = next;
      ctxRef.events.emit('tool:change', { tool: next });
    } finally {
      switching = false;
    }
  };

  /** Toggle: enter the tool, or fall back to select if it's already active. */
  const toggle = (tool: ToolName): Promise<void> =>
    setTool(activeTool === tool ? 'select' : tool);

  return {
    name: NAME,
    dependencies: ['selection', 'navigate', 'eraser', 'camera-fly'],

    getTool() {
      return activeTool;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'tool.set',
        (args: unknown) => {
          const tool = (args as { tool?: unknown } | null | undefined)?.tool;
          return isToolName(tool) ? setTool(tool) : Promise.resolve();
        },
        { title: 'Set the active pointer/camera tool' },
      );

      ctx.commands.register('tool.get', () => activeTool, {
        title: 'Get the active pointer/camera tool',
      });

      ctx.commands.register('tool.select', () => setTool('select'), {
        title: 'Activate select tool',
        defaultShortcut: '2',
      });
      ctx.commands.register('tool.navigate', () => toggle('navigate'), {
        title: 'Toggle navigate tool',
        defaultShortcut: '3',
      });
      ctx.commands.register('tool.eraser', () => toggle('eraser'), {
        title: 'Toggle eraser tool',
        defaultShortcut: '4',
      });
      ctx.commands.register('tool.fly', () => toggle('fly'), {
        title: 'Toggle fly navigation tool',
      });

      // Safety net: if a sub-tool is driven directly (not via tool.set) keep the
      // manager's notion of the active tool — and the exclusivity — in sync.
      const reconcile = (tool: 'navigate' | 'eraser', active: boolean): void => {
        if (switching) return;
        if (active && activeTool !== tool) {
          void exitAllExcept(tool);
          activeTool = tool;
          ctx.events.emit('tool:change', { tool });
        } else if (!active && activeTool === tool) {
          activeTool = 'select';
          ctx.events.emit('tool:change', { tool: 'select' });
        }
      };
      const offNavigate = ctx.events.on('navigate:change', ({ active }) => {
        reconcile('navigate', active);
      });
      const offEraser = ctx.events.on('eraser:change', ({ active }) => {
        reconcile('eraser', active);
      });
      disposers.push(offNavigate, offEraser);
    },

    uninstall() {
      for (const dispose of disposers.splice(0)) dispose();
      activeTool = 'select';
      ctxRef = null;
    },
  };
}
