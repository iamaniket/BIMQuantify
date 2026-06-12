/**
 * Tool-manager plugin — the single authority over two INDEPENDENT pointer/camera
 * axes:
 *
 *   - navMode: 'orbit' | 'firstPerson'   — the camera navigation mode.
 *   - action:  'none' | 'select' | 'erase' — what a left-click does to an entity.
 *
 * The two axes operate simultaneously: "orbit + erase" means the camera orbits
 * and clicking an element hides it; "orbit + select" selects; "orbit + none"
 * suppresses the click (the old `navigate` tool). First-person navigation locks
 * the left button for mouse-look, so while `navMode === 'firstPerson'` the action
 * axis is forced to `none` and is disabled in the UI; the pre-fly action is
 * remembered (`savedAction`) and restored when the user returns to orbit.
 *
 * Modal edit tools (measurement / section, via the `mode` plugin) borrow the
 * action axis transiently: `tool.pushOverride` on enter forces the *effective*
 * action to the neutral `none` baseline (eraser bind cleared + click-select /
 * hover gestures suppressed) without mutating the stored `action`, and
 * `tool.popOverride` on exit re-applies the stored `action`. So the eraser bind
 * is guaranteed cleared when an edit tool starts and restored when it ends —
 * this manager is the single arbiter of what a left-click does. While an
 * override is held (`overrideDepth > 0`) both axes are inert: edit mode is modal
 * over the pointer, just as first-person is over the action axis.
 *
 * Every state is reached by re-orchestrating existing sub-plugins:
 *   navMode orbit       → cameraFly.disable
 *   navMode firstPerson → cameraFly.enable (suppresses selection/hover + pivot)
 *   action  select      → neither navigate nor eraser active (default click bind)
 *   action  none        → navigate.enter (suppresses selection/hover gestures)
 *   action  erase       → eraser.enter (rebinds click:left → eraser.pickHide)
 *
 * Entry points:
 *   - `tool.set { navMode? , action? }` — programmatic / toolbar dispatch.
 *   - `tool.orbit` / `tool.firstPerson` — nav-axis commands (shortcuts 2/3).
 *   - `tool.select` / `tool.erase` — action-axis toggles (shortcuts 4/5); ignored
 *     while first-person is active or a modal override is held.
 *   - `tool.pushOverride` / `tool.popOverride` — enter/exit a modal edit-tool
 *     override (called by the `mode` plugin); no keyboard shortcut.
 *
 * As a safety net it also listens to `navigate:change` / `eraser:change` so the
 * `action` field stays correct even if a sub-tool is ever driven directly
 * (bypassing this manager).
 */

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'tool-manager' as const;

export type NavMode = 'orbit' | 'firstPerson';
export type ActionMode = 'none' | 'select' | 'erase';

const NAV_MODES: readonly NavMode[] = ['orbit', 'firstPerson'];
const ACTIONS: readonly ActionMode[] = ['none', 'select', 'erase'];

function isNavMode(value: unknown): value is NavMode {
  return typeof value === 'string' && (NAV_MODES as readonly string[]).includes(value);
}
function isActionMode(value: unknown): value is ActionMode {
  return typeof value === 'string' && (ACTIONS as readonly string[]).includes(value);
}

export interface ToolManagerPluginAPI {
  getNavMode(): NavMode;
  getAction(): ActionMode;
}

export function toolManagerPlugin(): Plugin & ToolManagerPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let navMode: NavMode = 'orbit';
  let action: ActionMode = 'none';
  // Remembers the action to restore when leaving first-person (where the action
  // axis is forced to `none`).
  let savedAction: ActionMode = 'none';
  // Guard so manager-initiated enter/exit (which re-emit navigate:change /
  // eraser:change) don't recurse back through the reconcile listeners.
  let switching = false;
  // How many modal edit-tool overrides are currently held (measurement / section
  // via `mode`). While > 0 both axes are inert and the effective action is forced
  // to the neutral `none` baseline — edit mode is modal over the pointer.
  let overrideDepth = 0;
  // Serializes override push/pop so a tool eviction (a pop immediately followed by
  // a push, when one edit tool replaces another) can't interleave two
  // `applyAction` runs and leave the wrong `click:left` binding live. Mirrors the
  // measurement plugin's clickChain pattern.
  let overrideChain: Promise<void> = Promise.resolve();

  const disposers: Array<() => void> = [];

  const exec = (command: string, args?: unknown): Promise<void> =>
    ctxRef?.commands.execute<unknown, void>(command, args).catch(() => undefined) ??
    Promise.resolve();

  /**
   * Drive the action axis. Only meaningful in orbit. Always settle back to the
   * `select` baseline (both sub-plugins off ⇒ default selection.pickSet + hover
   * gestures bound) before entering the incoming one. Ordering matters:
   * `eraser.enter` snapshots the current `click:left`, so navigate must be exited
   * first or the snapshot would capture an unbound gesture.
   */
  const applyAction = async (next: ActionMode): Promise<void> => {
    await exec('eraser.exit'); // no-op if inactive
    await exec('navigate.exit'); // no-op if inactive → now at 'select' baseline
    if (next === 'none') await exec('navigate.enter');
    else if (next === 'erase') await exec('eraser.enter');
    // 'select' ⇒ stay at baseline.
  };

  const setAction = async (next: ActionMode): Promise<void> => {
    if (!ctxRef || switching) return;
    // The action axis is inert while first-person owns the left button or a modal
    // edit tool holds an override (edit mode is modal over the action axis).
    if (navMode === 'firstPerson' || overrideDepth > 0 || next === action) return;
    switching = true;
    try {
      await applyAction(next);
      action = next;
      ctxRef.events.emit('action:change', { action: next });
    } finally {
      switching = false;
    }
  };

  const setNavMode = async (next: NavMode): Promise<void> => {
    // Inert while a modal edit tool holds an override — edit mode is modal over
    // the camera axis too (close the tool to switch nav modes).
    if (!ctxRef || switching || overrideDepth > 0 || next === navMode) return;
    switching = true;
    try {
      if (next === 'firstPerson') {
        // Remember the action, settle click:left back to the plain
        // selection.pickSet baseline so camera-fly's gesture suppression fully
        // covers it (a stray eraser.pickHide binding must not survive into fly),
        // then enable first-person and force the action axis to none.
        savedAction = action;
        await applyAction('select');
        await exec('cameraFly.enable');
        navMode = 'firstPerson';
        ctxRef.events.emit('navmode:change', { mode: 'firstPerson' });
        if (action !== 'none') {
          action = 'none';
          ctxRef.events.emit('action:change', { action: 'none' });
        }
      } else {
        // Back to orbit: drop first-person, restore the pre-fly action.
        await exec('cameraFly.disable');
        await applyAction(savedAction);
        navMode = 'orbit';
        ctxRef.events.emit('navmode:change', { mode: 'orbit' });
        if (action !== savedAction) {
          action = savedAction;
          ctxRef.events.emit('action:change', { action: savedAction });
        }
      }
    } finally {
      switching = false;
    }
  };

  /**
   * Hold a modal edit-tool override on the action axis. On the first push (in
   * orbit) the effective action drops to the neutral `none` baseline via
   * `applyAction`, whose `eraser.exit → navigate.enter` ordering clears any live
   * eraser bind *before* suppressing click-select/hover. The stored `action` is
   * never touched, so the toolbar keeps showing it and the matching pop restores
   * it exactly. In first-person camera-fly already owns the left button, so the
   * action sub-plugins are neutral and push/pop are no-ops. Serialized on
   * `overrideChain` so a pop-then-push eviction can't race.
   */
  const pushOverride = (): Promise<void> => {
    overrideChain = overrideChain.then(async () => {
      if (!ctxRef) return;
      overrideDepth += 1;
      if (overrideDepth !== 1 || navMode === 'firstPerson') return;
      switching = true;
      try {
        await applyAction('none');
      } finally {
        switching = false;
      }
    });
    return overrideChain;
  };

  const popOverride = (): Promise<void> => {
    overrideChain = overrideChain.then(async () => {
      if (!ctxRef || overrideDepth === 0) return;
      overrideDepth -= 1;
      if (overrideDepth !== 0 || navMode === 'firstPerson') return;
      switching = true;
      try {
        await applyAction(action);
      } finally {
        switching = false;
      }
    });
    return overrideChain;
  };

  return {
    name: NAME,
    dependencies: ['selection', 'navigate', 'eraser', 'camera-fly'],

    getNavMode() {
      return navMode;
    },
    getAction() {
      return action;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'tool.set',
        (args: unknown) => {
          const a = args as { navMode?: unknown; action?: unknown } | null | undefined;
          const tasks: Array<Promise<void>> = [];
          if (isNavMode(a?.navMode)) tasks.push(setNavMode(a.navMode));
          if (isActionMode(a?.action)) tasks.push(setAction(a.action));
          return Promise.all(tasks).then(() => undefined);
        },
        { title: 'Set the active navigation mode and/or click-action' },
      );

      ctx.commands.register('tool.get', () => ({ navMode, action }), {
        title: 'Get the active navigation mode and click-action',
      });

      ctx.commands.register('tool.orbit', () => setNavMode('orbit'), {
        title: 'Orbit navigation',
        defaultShortcut: '2',
      });
      ctx.commands.register(
        'tool.firstPerson',
        () => setNavMode(navMode === 'firstPerson' ? 'orbit' : 'firstPerson'),
        { title: 'Toggle first-person navigation', defaultShortcut: '3' },
      );
      ctx.commands.register(
        'tool.select',
        () => setAction(action === 'select' ? 'none' : 'select'),
        { title: 'Toggle select click-action', defaultShortcut: '4' },
      );
      ctx.commands.register(
        'tool.erase',
        () => setAction(action === 'erase' ? 'none' : 'erase'),
        { title: 'Toggle erase click-action', defaultShortcut: '5' },
      );

      // Modal edit tools (measurement / section, via `mode`) push an override
      // while active so the click-action axis is neutralized and restored as one
      // unit — the eraser bind is cleared on enter and restored on exit. No
      // shortcut: driven by `mode.enter` / `mode.exit`.
      ctx.commands.register('tool.pushOverride', () => pushOverride(), {
        title: 'Hold a modal edit-tool override on the click-action axis',
      });
      ctx.commands.register('tool.popOverride', () => popOverride(), {
        title: 'Release a modal edit-tool override on the click-action axis',
      });

      // Safety net: if a sub-tool is driven directly (not via this manager) keep
      // the `action` field — and the exclusivity — in sync. Only reconciles while
      // in orbit and not overridden; first-person / an override own the action
      // axis (forced none).
      const reconcile = (tool: 'navigate' | 'eraser', active: boolean): void => {
        if (switching || navMode === 'firstPerson' || overrideDepth > 0) return;
        const mapped: ActionMode = tool === 'navigate' ? 'none' : 'erase';
        if (active && action !== mapped) {
          // Mirror exclusivity: turning one on turns the other off.
          if (mapped === 'none') void exec('eraser.exit');
          else void exec('navigate.exit');
          action = mapped;
          ctx.events.emit('action:change', { action: mapped });
        } else if (!active && action === mapped) {
          // navigate.exit / eraser.exit returns us to the select baseline.
          action = 'select';
          ctx.events.emit('action:change', { action: 'select' });
        }
      };
      const offNavigate = ctx.events.on('navigate:change', ({ active }) => {
        reconcile('navigate', active);
      });
      const offEraser = ctx.events.on('eraser:change', ({ active }) => {
        reconcile('eraser', active);
      });
      disposers.push(offNavigate, offEraser);

      // Apply the default state (orbit + no action ⇒ clicks suppressed) once the
      // dependency plugins are installed.
      void applyAction(action);
    },

    uninstall() {
      for (const dispose of disposers.splice(0)) dispose();
      navMode = 'orbit';
      action = 'none';
      savedAction = 'none';
      overrideDepth = 0;
      overrideChain = Promise.resolve();
      ctxRef = null;
    },
  };
}
