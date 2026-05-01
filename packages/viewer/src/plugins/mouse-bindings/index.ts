/**
 * Mouse-bindings plugin. Mirrors `keyboard-shortcuts`: a single owner of
 * canvas pointer events that translates each gesture to a viewer command
 * and dispatches it. Selection / hover / any custom plugin no longer
 * touches the canvas — they just register commands and let the user (or
 * defaults) decide which gesture invokes them.
 *
 * Gesture grammar:
 *   click:[mods+]button   e.g. "click:left", "click:Shift+left", "click:right"
 *   move                  pointer-move (continuous, rAF-coalesced)
 *   move:leave            pointer leaves the canvas
 *
 * Modifiers (case-insensitive in input, canonical-cased in keys):
 *   Ctrl, Alt, Shift, Meta. Order in the canonical key is fixed:
 *   Ctrl+Alt+Shift+Meta+button.
 *
 * Buttons:
 *   left | middle | right (canonical-cased lower).
 *
 * Bound commands receive a payload of:
 *   click: { ndc: {x,y}, button: 'left'|'middle'|'right',
 *            shift: boolean, ctrl: boolean, alt: boolean, meta: boolean }
 *   move:  { ndc: {x,y} | null }
 */

import { clientToNdc } from '../../core/Raycaster.js';
import type { MouseBindingMap, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'mouse-bindings' as const;

export interface MouseBindingsPluginOptions {
  /** Bindings keyed `gesture → commandName`. Override the defaults below. */
  overrides?: MouseBindingMap;
  /**
   * Drag distance in px above which a pointerup is treated as a drag,
   * not a click. Default: 4.
   */
  clickThreshold?: number;
}

export interface MouseBindingsAPI {
  bind(gesture: string, commandName: string): void;
  unbind(gesture: string): void;
  list(): { gesture: string; command: string }[];
}

export const DEFAULT_MOUSE_BINDINGS: MouseBindingMap = {
  'click:left': 'selection.pickSet',
  'click:Shift+left': 'selection.pickAdd',
  'click:Ctrl+left': 'selection.pickToggle',
  'click:Meta+left': 'selection.pickToggle',
  'click:Alt+left': 'selection.pickRemove',
  move: 'hover.pick',
  'move:leave': 'hover.clear',
};

const BUTTON_NAME: Record<number, 'left' | 'middle' | 'right'> = {
  0: 'left',
  1: 'middle',
  2: 'right',
};

export function mouseBindingsPlugin(
  options: MouseBindingsPluginOptions = {},
): Plugin & MouseBindingsAPI {
  const clickThreshold = options.clickThreshold ?? 4;

  // canonical gesture key → command name
  const bindings = new Map<string, string>();

  // Seed defaults; overlay overrides on top.
  for (const [g, c] of Object.entries(DEFAULT_MOUSE_BINDINGS)) {
    bindings.set(canonicalize(g), c);
  }
  for (const [g, c] of Object.entries(options.overrides ?? {})) {
    bindings.set(canonicalize(g), c);
  }

  let cleanup: (() => void) | null = null;

  const hasRightClickGesture = (): boolean => {
    for (const k of bindings.keys()) {
      if (k.startsWith('click:') && k.endsWith('+right')) return true;
      if (k === 'click:right') return true;
    }
    return false;
  };

  const api: Plugin & MouseBindingsAPI = {
    name: NAME,

    bind(gesture: string, commandName: string) {
      bindings.set(canonicalize(gesture), commandName);
    },
    unbind(gesture: string) {
      bindings.delete(canonicalize(gesture));
    },
    list() {
      return [...bindings].map(([gesture, command]) => ({ gesture, command }));
    },

    install(ctx: ViewerContext) {
      const canvas = ctx.canvas;

      let downX = 0;
      let downY = 0;
      let downBtn = -1;

      // rAF-coalesce move dispatch — pointermove can fire >100Hz and the
      // bound command (typically `hover.pick`) is async.
      let pendingMoveNdc: { x: number; y: number } | null = null;
      let raf = 0;
      const flushMove = (): void => {
        raf = 0;
        const ndc = pendingMoveNdc;
        if (!ndc) return;
        pendingMoveNdc = null;
        const cmd = bindings.get('move');
        if (!cmd) return;
        ctx.events.emit('pointer:move', {
          ndc,
          clientX: NaN,
          clientY: NaN,
        });
        runCommand(ctx, cmd, { ndc });
      };

      const onMove = (ev: PointerEvent): void => {
        const ndc = clientToNdc(canvas, ev.clientX, ev.clientY);
        pendingMoveNdc = ndc;
        // Re-emit with full payload (clientX/Y) — independent of the
        // bound command, so listeners that just want the bus event work.
        ctx.events.emit('pointer:move', {
          ndc,
          clientX: ev.clientX,
          clientY: ev.clientY,
        });
        if (!raf) raf = requestAnimationFrame(flushMove);
      };

      const onLeave = (): void => {
        pendingMoveNdc = null;
        const cmd = bindings.get('move:leave');
        if (cmd) runCommand(ctx, cmd, { ndc: null });
      };

      const onDown = (ev: PointerEvent): void => {
        // If any click-binding uses this button, swallow native side-
        // effects (browser back/forward on side buttons, autoscroll on
        // middle, etc.).
        if (anyClickBindingFor(bindings, ev)) ev.preventDefault();
        downX = ev.clientX;
        downY = ev.clientY;
        downBtn = ev.button;
      };

      const onUp = (ev: PointerEvent): void => {
        if (ev.button !== downBtn) return;
        const dx = ev.clientX - downX;
        const dy = ev.clientY - downY;
        if (Math.hypot(dx, dy) > clickThreshold) return; // it was a drag

        const button = BUTTON_NAME[ev.button];
        if (!button) return;
        const ndc = clientToNdc(canvas, ev.clientX, ev.clientY);
        const gesture = clickGestureFor(button, ev);
        ctx.events.emit('pointer:click', {
          ndc,
          button: ev.button,
          shift: ev.shiftKey,
          ctrl: ev.ctrlKey,
          meta: ev.metaKey,
        });
        const cmd = bindings.get(gesture);
        if (!cmd) return;
        runCommand(ctx, cmd, {
          ndc,
          button,
          shift: ev.shiftKey,
          ctrl: ev.ctrlKey,
          alt: ev.altKey,
          meta: ev.metaKey,
        });
      };

      const onContextMenu = (ev: MouseEvent): void => {
        // Only suppress the browser context menu when the user has bound
        // a right-click gesture — otherwise leave default behaviour alone.
        if (hasRightClickGesture()) ev.preventDefault();
      };

      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('contextmenu', onContextMenu);

      ctx.commands.register(
        'mouseBindings.bind',
        (args: unknown) => {
          const a = args as { gesture: string; command: string };
          api.bind(a.gesture, a.command);
        },
        { title: 'Bind mouse gesture' },
      );
      ctx.commands.register(
        'mouseBindings.unbind',
        (args: unknown) => {
          const a = args as { gesture: string };
          api.unbind(a.gesture);
        },
        { title: 'Unbind mouse gesture' },
      );
      ctx.commands.register('mouseBindings.list', () => api.list(), {
        title: 'List mouse bindings',
      });

      cleanup = (): void => {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('contextmenu', onContextMenu);
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        pendingMoveNdc = null;
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      bindings.clear();
    },
  };

  return api;
}

function runCommand(ctx: ViewerContext, name: string, args: unknown): void {
  void ctx.commands
    .execute(name, args)
    .then(() =>
      ctx.events.emit('command:executed', { name, ok: true }),
    )
    .catch((err: unknown) =>
      ctx.events.emit('command:executed', {
        name,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

function clickGestureFor(
  button: 'left' | 'middle' | 'right',
  ev: PointerEvent,
): string {
  const mods: string[] = [];
  if (ev.ctrlKey) mods.push('Ctrl');
  if (ev.altKey) mods.push('Alt');
  if (ev.shiftKey) mods.push('Shift');
  if (ev.metaKey) mods.push('Meta');
  const prefix = mods.length ? `${mods.join('+')}+` : '';
  return `click:${prefix}${button}`;
}

function anyClickBindingFor(bindings: Map<string, string>, ev: PointerEvent): boolean {
  const button = BUTTON_NAME[ev.button];
  if (!button) return false;
  // Any binding for this button (with or without the current modifiers) —
  // we can't know modifier state precisely until pointerup, so accept any
  // click:*+button match as a hint to swallow native side-effects.
  for (const k of bindings.keys()) {
    if (k === `click:${button}`) return true;
    if (k.startsWith('click:') && k.endsWith(`+${button}`)) return true;
  }
  return false;
}

export function canonicalize(gesture: string): string {
  const trimmed = gesture.trim();
  if (trimmed === 'move' || trimmed === 'move:leave') return trimmed;
  if (!trimmed.startsWith('click:')) return trimmed;
  const body = trimmed.slice('click:'.length);
  const parts = body.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return trimmed;
  const buttonRaw = parts.pop()!.toLowerCase();
  const button =
    buttonRaw === 'l' || buttonRaw === 'left'
      ? 'left'
      : buttonRaw === 'm' || buttonRaw === 'middle'
        ? 'middle'
        : buttonRaw === 'r' || buttonRaw === 'right'
          ? 'right'
          : buttonRaw;
  const mods = new Set(parts.map((m) => m.toLowerCase()));
  const ordered: string[] = [];
  if (mods.has('ctrl') || mods.has('control')) ordered.push('Ctrl');
  if (mods.has('alt') || mods.has('option')) ordered.push('Alt');
  if (mods.has('shift')) ordered.push('Shift');
  if (mods.has('meta') || mods.has('cmd') || mods.has('command')) ordered.push('Meta');
  ordered.push(button);
  return `click:${ordered.join('+')}`;
}
