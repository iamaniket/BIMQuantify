/**
 * Keyboard shortcuts plugin. Builds a `keyCombo → commandName` map from
 * each command's `defaultShortcut` metadata, applies user overrides on
 * top, and dispatches commands on `keydown`.
 *
 * Combo grammar: zero-or-more modifiers from `{Ctrl, Shift, Alt, Meta}`
 * separated by `+`, ending with a single key. The key matches against
 * `KeyboardEvent.code` first (e.g. "Numpad7", "KeyF") and then against
 * `KeyboardEvent.key` (e.g. "Escape", "f"). Examples:
 *   "Escape", "F", "Shift+F", "Ctrl+1", "Numpad0".
 */

import type { Plugin, ShortcutMap, ViewerContext } from '../../core/types.js';

const NAME = 'keyboard-shortcuts' as const;

interface KeyboardPluginOptions {
  /** Overrides keyed by command name → combo. */
  overrides?: ShortcutMap;
  /** When focus is in one of these tag names, skip dispatch. */
  ignoreTags?: string[];
}

export interface KeyboardShortcutsAPI {
  bind(combo: string, commandName: string): void;
  unbind(combo: string): void;
  list(): { combo: string; command: string }[];
}

export function keyboardShortcutsPlugin(
  options: KeyboardPluginOptions = {},
): Plugin & KeyboardShortcutsAPI {
  const overrides = options.overrides ?? {};
  const ignoreTags = new Set(
    (options.ignoreTags ?? ['INPUT', 'TEXTAREA', 'SELECT']).map((t) => t.toUpperCase()),
  );

  // combo (canonical) → command name
  const bindings = new Map<string, string>();
  let cleanup: (() => void) | null = null;
  let ctxRef: ViewerContext | null = null;

  const api: Plugin & KeyboardShortcutsAPI = {
    name: NAME,

    bind(combo: string, commandName: string) {
      bindings.set(canonicalize(combo), commandName);
    },
    unbind(combo: string) {
      bindings.delete(canonicalize(combo));
    },
    list() {
      return [...bindings].map(([combo, command]) => ({ combo, command }));
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      // Seed defaults from registered command metadata.
      for (const { name, meta } of ctx.commands.list()) {
        if (meta.defaultShortcut) {
          bindings.set(canonicalize(meta.defaultShortcut), name);
        }
      }
      // Apply user overrides: input shape is { commandName: combo }, but
      // we accept the inverse too (combo → commandName) because users
      // often type it that way.
      for (const [k, v] of Object.entries(overrides)) {
        if (ctx.commands.has(k)) {
          // k is a command name, v is the combo
          bindings.set(canonicalize(v), k);
        } else {
          // assume k is the combo, v is the command name
          bindings.set(canonicalize(k), v);
        }
      }

      // Container needs tabindex to receive focus, otherwise keydown
      // never fires unless the canvas itself has focus.
      if (!ctx.container.hasAttribute('tabindex')) {
        ctx.container.setAttribute('tabindex', '0');
      }

      const onKey = (ev: KeyboardEvent): void => {
        const target = ev.target as HTMLElement | null;
        if (target && ignoreTags.has(target.tagName)) return;
        if (target?.isContentEditable) return;
        const combo = comboFromEvent(ev);
        const cmd = bindings.get(combo);
        if (!cmd) return;
        ev.preventDefault();
        void ctx.commands
          .execute(cmd)
          .then(() =>
            ctx.events.emit('command:executed', { name: cmd, ok: true }),
          )
          .catch((err: unknown) =>
            ctx.events.emit('command:executed', {
              name: cmd,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
      };

      ctx.container.addEventListener('keydown', onKey);
      // Also listen on window so shortcuts work without explicit focus,
      // but skip if focus is in another input element.
      const onWindowKey = (ev: KeyboardEvent): void => {
        if (ctx.container.contains(ev.target as Node)) return; // already handled above
        const target = ev.target as HTMLElement | null;
        if (target && ignoreTags.has(target.tagName)) return;
        if (target?.isContentEditable) return;
        // Only fire window-level shortcuts when the viewer's container is
        // the most recently hovered/focused. Cheap heuristic: check :hover.
        if (!ctx.container.matches(':hover') && document.activeElement !== ctx.container) {
          return;
        }
        onKey(ev);
      };
      window.addEventListener('keydown', onWindowKey);

      ctx.commands.register(
        'shortcuts.bind',
        (args: unknown) => {
          const a = args as { combo: string; command: string };
          api.bind(a.combo, a.command);
        },
        { title: 'Bind keyboard shortcut' },
      );
      ctx.commands.register(
        'shortcuts.unbind',
        (args: unknown) => {
          const a = args as { combo: string };
          api.unbind(a.combo);
        },
        { title: 'Unbind keyboard shortcut' },
      );
      ctx.commands.register('shortcuts.list', () => api.list(), {
        title: 'List keyboard shortcuts',
      });

      cleanup = (): void => {
        ctx.container.removeEventListener('keydown', onKey);
        window.removeEventListener('keydown', onWindowKey);
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      bindings.clear();
      ctxRef = null;
    },
  };

  return api;
}

function canonicalize(combo: string): string {
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  const key = parts.pop()!;
  const mods = new Set(parts.map((m) => m.toLowerCase()));
  const ordered: string[] = [];
  if (mods.has('ctrl') || mods.has('control')) ordered.push('Ctrl');
  if (mods.has('alt') || mods.has('option')) ordered.push('Alt');
  if (mods.has('shift')) ordered.push('Shift');
  if (mods.has('meta') || mods.has('cmd') || mods.has('command')) ordered.push('Meta');
  ordered.push(normalizeKey(key));
  return ordered.join('+');
}

function normalizeKey(key: string): string {
  // Pass through `code` values unchanged; map common `key` values to
  // canonical forms; uppercase single-letter keys.
  if (key.length === 1) return key.toUpperCase();
  if (key === 'esc') return 'Escape';
  if (key === ' ') return 'Space';
  return key;
}

function comboFromEvent(ev: KeyboardEvent): string {
  const ordered: string[] = [];
  if (ev.ctrlKey) ordered.push('Ctrl');
  if (ev.altKey) ordered.push('Alt');
  if (ev.shiftKey) ordered.push('Shift');
  if (ev.metaKey) ordered.push('Meta');

  // Try `code` first (so Numpad keys are reliable across layouts), then
  // fall back to `key`.
  const codeMatch = ev.code; // e.g. "Numpad7", "KeyF", "Escape", "Space"
  // For letter keys, prefer the visible character so "Shift+F" works.
  if (codeMatch.startsWith('Key') && codeMatch.length === 4) {
    ordered.push(codeMatch.slice(3));
    return ordered.join('+');
  }
  if (codeMatch.startsWith('Numpad')) {
    ordered.push(codeMatch);
    return ordered.join('+');
  }
  // Map a few common keys to canonical form.
  let key = ev.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  ordered.push(key);
  return ordered.join('+');
}
