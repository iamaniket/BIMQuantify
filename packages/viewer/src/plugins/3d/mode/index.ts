import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'mode' as const;

export type ViewerMode = 'normal' | 'edit';

export interface ModeToolDescriptor {
  /** Unique tool identifier, e.g. "measurement.distance". */
  name: string;
  /** Human-readable label shown in the mode indicator. */
  label: string;
  /**
   * Called on ESC. Return `true` if the tool handled the cancellation
   * internally (e.g. cleared pending points) — edit mode stays active.
   * Return `false` if there was nothing to cancel — mode plugin will
   * exit edit mode entirely.
   */
  cancel: () => boolean;
  /** Called when edit mode exits so the tool can clean up. */
  onExit?: () => void;
  /**
   * When true, camera orbit/pan/zoom stay active during edit mode.
   * Use for click-based tools (section placement, measurement) where
   * mouse drags should still control the camera. The `pointer:click`
   * event already distinguishes clicks (< 4px movement) from drags,
   * so there is no conflict.
   *
   * Default: false (legacy behavior — camera disabled).
   */
  preserveCamera?: boolean;
}

export interface ModePluginAPI {
  mode(): ViewerMode;
  activeTool(): ModeToolDescriptor | null;
}

export function modePlugin(): Plugin & ModePluginAPI {
  let ctxRef: ViewerContext | null = null;
  let currentTool: ModeToolDescriptor | null = null;
  let savedLeftAction: number | null = null;
  let pluginUnregSub: (() => void) | null = null;
  let viewcubeEl: HTMLElement | null = null;
  let exitChain: Promise<void> = Promise.resolve();

  const setViewcubeVisible = (visible: boolean): void => {
    if (!ctxRef) return;
    if (!viewcubeEl) {
      viewcubeEl = ctxRef.container.querySelector('[data-viewcube]') as HTMLElement | null;
    }
    if (viewcubeEl) viewcubeEl.style.display = visible ? '' : 'none';
  };

  const enter = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    const tool = args as ModeToolDescriptor;
    if (!tool?.name || !tool?.label || typeof tool.cancel !== 'function') return;

    if (currentTool !== null) await exit();

    currentTool = tool;

    const controls = ctxRef.cameraControls;
    const ACTION = (controls.constructor as { ACTION?: Record<string, number> }).ACTION;
    if (ACTION && !tool.preserveCamera) {
      savedLeftAction = controls.mouseButtons.left as number;
      controls.mouseButtons.left = (ACTION['NONE'] ?? 0) as typeof controls.mouseButtons.left;
    }

    // Hand the click-action axis to the tool-manager override: it clears any live
    // eraser bind and suppresses click-select / hover gestures as one unit, then
    // restores the prior action on exit. tool-manager is the single arbiter of
    // what a left-click does, so `mode` no longer toggles selection/hover here.
    // Optional dependency — degrades gracefully if tool-manager is absent.
    await ctxRef.commands.execute('tool.pushOverride').catch(() => undefined);

    setViewcubeVisible(false);

    ctxRef.events.emit('mode:enter', {
      toolName: tool.name,
      toolLabel: tool.label,
    });
  };

  const exit = (): Promise<void> => {
    exitChain = exitChain.then(async () => {
      const ctx = ctxRef;
      if (!ctx || currentTool === null) return;
      const toolName = currentTool.name;
      const onExit = currentTool.onExit;
      currentTool = null;

      onExit?.();

      if (savedLeftAction !== null) {
        ctx.cameraControls.mouseButtons.left = savedLeftAction as typeof ctx.cameraControls.mouseButtons.left;
        savedLeftAction = null;
      }

      // Release the click-action override — restores the action that was live before
      // the tool started (erase/select/none) and its `click:left` binding.
      await ctx.commands.execute('tool.popOverride').catch(() => undefined);
      setViewcubeVisible(true);

      ctx.events.emit('mode:exit', { toolName });
    });
    return exitChain;
  };

  const cancel = async (): Promise<boolean> => {
    if (currentTool === null) {
      await ctxRef?.commands.execute('selection.clear').catch(() => undefined);
      return false;
    }
    const handled = currentTool.cancel();
    if (!handled) await exit();
    return true;
  };

  return {
    name: NAME,
    // Soft coupling: edit-mode enter/exit delegates the click-action neutralization
    // to tool-manager's push/pop override. Optional (not a hard dep) because `mode`
    // installs before tool-manager and only calls it at runtime.
    optionalDependencies: ['tool-manager'],

    mode() { return currentTool !== null ? 'edit' : 'normal'; },
    activeTool() { return currentTool; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('mode.enter', (args: unknown) => enter(args), {
        title: 'Enter edit mode',
      });
      ctx.commands.register('mode.exit', () => exit(), {
        title: 'Exit edit mode',
      });
      ctx.commands.register('mode.cancel', () => cancel(), {
        title: 'Cancel or exit edit mode',
        defaultShortcut: 'Escape',
      });
      ctx.commands.register('mode.get', () => (currentTool !== null ? 'edit' : 'normal'), {
        title: 'Get current mode',
      });
      ctx.commands.register('mode.getTool', () => currentTool, {
        title: 'Get active tool descriptor',
      });

      pluginUnregSub = ctx.events.on('plugin:unregistered', ({ name }) => {
        if (currentTool !== null && currentTool.name.startsWith(name)) {
          void exit();
        }
      });
    },

    async uninstall() {
      await exit();
      pluginUnregSub?.();
      pluginUnregSub = null;
      ctxRef = null;
    },
  };
}
