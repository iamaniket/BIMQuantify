import type { Plugin, ViewerContext } from '../../core/types.js';

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
  let savedSelectionEnabled = true;
  let savedHoverEnabled = true;
  let savedLeftAction: number | null = null;
  let pluginUnregSub: (() => void) | null = null;
  let viewcubeEl: HTMLElement | null = null;

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

    if (currentTool !== null) exit();

    currentTool = tool;

    const controls = ctxRef.cameraControls;
    const ACTION = (controls.constructor as { ACTION?: Record<string, number> }).ACTION;
    if (ACTION && !tool.preserveCamera) {
      savedLeftAction = controls.mouseButtons.left as number;
      controls.mouseButtons.left = (ACTION['NONE'] ?? 0) as typeof controls.mouseButtons.left;
    }

    try {
      savedSelectionEnabled = (await ctxRef.commands.execute<undefined, boolean>('selection.isEnabled')) ?? true;
      await ctxRef.commands.execute('selection.setEnabled', false);
    } catch { /* selection plugin may not exist */ }

    try {
      savedHoverEnabled = (await ctxRef.commands.execute<undefined, boolean>('hover.isEnabled')) ?? true;
      await ctxRef.commands.execute('hover.setEnabled', false);
    } catch { /* hover plugin may not exist */ }

    setViewcubeVisible(false);

    ctxRef.events.emit('mode:enter', {
      toolName: tool.name,
      toolLabel: tool.label,
    });
  };

  const exit = (): void => {
    if (!ctxRef || currentTool === null) return;
    const toolName = currentTool.name;
    const onExit = currentTool.onExit;
    currentTool = null;

    onExit?.();

    if (savedLeftAction !== null) {
      ctxRef.cameraControls.mouseButtons.left = savedLeftAction as typeof ctxRef.cameraControls.mouseButtons.left;
      savedLeftAction = null;
    }

    ctxRef.commands.execute('selection.setEnabled', savedSelectionEnabled).catch(() => undefined);
    ctxRef.commands.execute('hover.setEnabled', savedHoverEnabled).catch(() => undefined);
    setViewcubeVisible(true);

    ctxRef.events.emit('mode:exit', { toolName });
  };

  const cancel = (): boolean => {
    if (currentTool === null) {
      ctxRef?.commands.execute('selection.clear').catch(() => undefined);
      return false;
    }
    const handled = currentTool.cancel();
    if (!handled) exit();
    return true;
  };

  return {
    name: NAME,

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
          exit();
        }
      });
    },

    uninstall() {
      if (currentTool !== null) exit();
      pluginUnregSub?.();
      pluginUnregSub = null;
      ctxRef = null;
    },
  };
}
