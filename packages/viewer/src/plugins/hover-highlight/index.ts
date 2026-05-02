/**
 * Hover-highlight plugin. Registers a `hover.pick` command that takes
 * an NDC point (or null to clear), raycasts, and applies a translucent
 * highlight to the picked item. Selection takes priority — already-
 * selected items are not over-highlighted (avoids material flicker).
 *
 * The plugin owns no DOM listeners. The `mouse-bindings` plugin is the
 * single owner of canvas pointer events and dispatches `hover.pick` for
 * whichever pointer gesture the user has bound to it (default: `move`).
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

import { pick } from '../../core/Raycaster.js';
import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';
import { EdgeOverlay } from '../shared/edge-overlay.js';

const NAME = 'hover-highlight' as const;

export interface HoverPluginOptions {
  /** Highlight color. Default: gold yellow. */
  color?: number;
  /** Opacity (0–1). Default: 0.5. */
  opacity?: number;
}

export interface HoverPluginAPI {
  /** Pause/resume hover raycasts. Clears the current highlight on pause. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

export function hoverHighlightPlugin(
  options: HoverPluginOptions = {},
): Plugin & HoverPluginAPI {
  const color = new THREE.Color(options.color ?? 0xffd700);
  const opacity = options.opacity ?? 0.5;

  let ctxRef: ViewerContext | null = null;
  let current: ItemId | null = null;
  let inFlight = false;
  let pending: { x: number; y: number } | null = null;
  let enabled = true;
  const edges = new EdgeOverlay();

  const material: FRAGS.MaterialDefinition = {
    color,
    opacity,
    transparent: opacity < 1,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    customId: 'hover',
  };

  const isSelected = (item: ItemId): boolean => {
    const sel = ctxRef?.plugins.get<{ hasItem(i: ItemId): boolean }>('selection');
    return sel?.hasItem(item) ?? false;
  };

  const apply = async (next: ItemId | null): Promise<void> => {
    if (!ctxRef) return;
    if (sameItem(next, current)) return;
    const prev = current;
    current = next;
    if (prev) {
      const model = ctxRef.models().get(prev.modelId);
      await model?.resetHighlight([prev.localId]).catch(() => undefined);
      edges.remove(ctxRef, [prev]);
    }
    if (next && !isSelected(next)) {
      const model = ctxRef.models().get(next.modelId);
      await model?.highlight([next.localId], material).catch(() => undefined);
      void edges.add(ctxRef, [next], color);
    }
    ctxRef.events.emit('hover:change', { item: next });
  };

  // Coalesce concurrent picks. If a pick is in flight when a new NDC
  // arrives, hold it as `pending` and run it once the in-flight one
  // resolves. The picker is async (worker raycast) so naive dispatch
  // would queue a backlog at high pointermove rates.
  const dispatch = async (ndc: { x: number; y: number } | null): Promise<void> => {
    if (!ctxRef) return;
    if (!enabled) {
      pending = null;
      return;
    }
    if (ndc === null) {
      pending = null;
      if (current) await apply(null);
      return;
    }
    pending = ndc;
    if (inFlight) return;
    inFlight = true;
    try {
      while (pending) {
        const next = pending;
        pending = null;
        const hit = await pick(ctxRef, next);
        await apply(hit?.item ?? null);
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    name: NAME,

    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled && current) void apply(null);
    },
    isEnabled() {
      return enabled;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'hover.pick',
        (args: unknown) => {
          // args may be `{ ndc: {x,y} }`, a bare `{x,y}`, or `null` to clear.
          if (args === null || args === undefined) return dispatch(null);
          const a = args as { ndc?: { x: number; y: number } | null; x?: number; y?: number };
          if (a.ndc === null) return dispatch(null);
          if (a.ndc) return dispatch(a.ndc);
          if (typeof a.x === 'number' && typeof a.y === 'number') {
            return dispatch({ x: a.x, y: a.y });
          }
          return dispatch(null);
        },
        { title: 'Update hover highlight at pointer' },
      );

      ctx.commands.register('hover.clear', () => dispatch(null), {
        title: 'Clear hover highlight',
      });
    },

    uninstall() {
      if (current && ctxRef) {
        const model = ctxRef.models().get(current.modelId);
        model?.resetHighlight([current.localId]).catch(() => undefined);
        edges.dispose(ctxRef);
      }
      current = null;
      pending = null;
      inFlight = false;
      ctxRef = null;
    },
  };
}

function sameItem(a: ItemId | null, b: ItemId | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.modelId === b.modelId && a.localId === b.localId;
}
