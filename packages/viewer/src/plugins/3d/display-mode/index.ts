/**
 * display-mode — the single source of truth for the viewer's mutually-exclusive
 * display mode: `normal | xray | monochrome | clay | matcap`.
 *
 * Coordinator, not an implementation: the three material "looks" are applied by
 * the Viewer itself (`ctx.setActiveLook`, which composes them with the coplanar
 * depth bias and re-applies to streamed materials), and `xray` is delegated to
 * the existing `xray` plugin (`xray.all` / `xray.clear`) so its selection-aware
 * feature set, edge overlay, X shortcut and context menu stay untouched.
 *
 * Exclusivity lives here, in the viewer: entering a look clears x-ray; entering
 * x-ray resets the look. The plugin also reflects x-ray toggled from OUTSIDE the
 * menu (X shortcut, context menu) back into `mode`, so exactly one mode is ever
 * active. The portal toolbar just calls `display.set(...)` and listens to
 * `display:change` — no per-mode command mapping on the UI side.
 *
 * Commands live under the `display.*` namespace — the `mode.*` namespace is
 * owned by the edit-`mode` plugin (tool enter/exit), a different concern.
 *
 * Commands:
 *   - `display.set` `{ mode }` | `'<mode>'` — switch mode.
 *   - `display.get` — current mode.
 *   - `display.cycle` — advance to the next mode.
 */

import type { MaterialLook, Plugin, ViewerContext } from '../../../core/types.js';
import { DISPLAY_MODES, type DisplayMode } from './types.js';

const NAME = 'display-mode' as const;

export interface DisplayModePluginAPI {
  getMode(): DisplayMode;
}

const isDisplayMode = (v: unknown): v is DisplayMode =>
  typeof v === 'string' && (DISPLAY_MODES as readonly string[]).includes(v);

/** Map a display mode to the material look it applies (x-ray/normal → none). */
const lookFor = (mode: DisplayMode): MaterialLook =>
  mode === 'monochrome' || mode === 'clay' || mode === 'matcap' ? mode : 'normal';

export function displayModePlugin(): Plugin & DisplayModePluginAPI {
  let ctxRef: ViewerContext | null = null;
  let mode: DisplayMode = 'normal';
  // Raised while we drive the xray plugin ourselves, so the `xray:change` it
  // emits doesn't bounce back through our own reflection handler.
  let drivingXray = false;

  const emit = (): void => {
    ctxRef?.events.emit('display:change', { mode });
  };

  const setMode = async (next: DisplayMode): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx || next === mode) return;

    drivingXray = true;
    try {
      // Leaving x-ray: clear it (delegated to the xray plugin).
      if (mode === 'xray' && next !== 'xray') {
        await ctx.commands.execute('xray.clear');
      }
      // Apply the material look ('normal' for normal/xray).
      ctx.setActiveLook(lookFor(next));
      // Entering x-ray: ghost the whole model via the existing feature.
      if (next === 'xray') {
        await ctx.commands.execute('xray.all');
      }
    } finally {
      drivingXray = false;
    }

    mode = next;
    emit();
  };

  const cycle = (): Promise<void> => {
    const i = DISPLAY_MODES.indexOf(mode);
    return setMode(DISPLAY_MODES[(i + 1) % DISPLAY_MODES.length]!);
  };

  const api: Plugin & DisplayModePluginAPI = {
    name: NAME,
    // Delegates to the xray plugin's commands at runtime — declared so the
    // registry installs xray first.
    dependencies: ['xray'],

    getMode() {
      return mode;
    },

    install(ctx: ViewerContext): void {
      ctxRef = ctx;

      ctx.commands.register(
        'display.set',
        (args: unknown) => {
          const m = typeof args === 'string' ? args : (args as { mode?: unknown } | null)?.mode;
          return isDisplayMode(m) ? setMode(m) : undefined;
        },
        { title: 'Set viewer display mode' },
      );
      ctx.commands.register('display.get', () => mode, { title: 'Get viewer display mode' });
      ctx.commands.register('display.cycle', () => cycle(), { title: 'Cycle viewer display mode' });

      // Reflect x-ray toggled outside this plugin (X shortcut / context menu):
      // any x-ray activity becomes mode `xray` (dropping a look); clearing it
      // returns to `normal`. Keeps the menu's single active mode honest.
      ctx.events.on('xray:change', ({ xrayed }) => {
        if (drivingXray) return;
        const xrayOn = xrayed.length > 0;
        if (xrayOn && mode !== 'xray') {
          ctx.setActiveLook('normal');
          mode = 'xray';
          emit();
        } else if (!xrayOn && mode === 'xray') {
          mode = 'normal';
          emit();
        }
      });
    },

    uninstall(): void {
      if (ctxRef && mode !== 'normal') {
        if (mode === 'xray') void ctxRef.commands.execute('xray.clear');
        ctxRef.setActiveLook('normal');
      }
      ctxRef = null;
      mode = 'normal';
    },
  };

  return api;
}
