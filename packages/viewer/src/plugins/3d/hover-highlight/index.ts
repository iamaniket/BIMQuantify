/**
 * Hover-highlight plugin. Registers a `hover.pick` command that takes
 * an NDC point (or null to clear), raycasts, and applies a translucent
 * color highlight to the picked item via `FragmentsModel.setColor`.
 *
 * Selection takes priority — already-selected items are not over-painted
 * by hover (selection's color stays visible).
 *
 * The plugin owns no DOM listeners. The `mouse-bindings` plugin is the
 * single owner of canvas pointer events and dispatches `hover.pick` for
 * whichever pointer gesture the user has bound to it (default: `move`).
 */

import * as THREE from 'three';

import { pick } from '../../../core/Raycaster.js';
import type { ItemId, Plugin, ViewerContext } from '../../../core/types.js';
import { isPointClipped, type SectionPlaneData } from '../shared/clipping.js';
import { EdgeOverlay } from '../shared/edge-overlay.js';

const NAME = 'hover-highlight' as const;

export interface HoverPluginOptions {
  /** Highlight color. Default: gold yellow. */
  color?: number;
  /** Reserved — color highlight via setColor preserves item opacity. */
  opacity?: number;
}

export interface HoverPluginAPI {
  /** Pause/resume hover raycasts. Clears the current highlight on pause. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
}

interface SelectionShape {
  hasItem(i: ItemId): boolean;
}

export function hoverHighlightPlugin(
  options: HoverPluginOptions = {},
): Plugin & HoverPluginAPI {
  const color = new THREE.Color(options.color ?? 0xffd700);

  let ctxRef: ViewerContext | null = null;
  // `current` is the latest hover target (whatever the pointer is over),
  // independent of whether we actually painted it. `painted` is what we
  // currently have setColor applied to — we only resetColor on items in
  // `painted`, so a selected item the pointer happens to be over isn't
  // accidentally cleared.
  let current: ItemId | null = null;
  let painted: ItemId | null = null;
  let inFlight = false;
  let pending: { x: number; y: number } | null = null;
  let enabled = true;
  const edges = new EdgeOverlay({ lineWidth: 1.5 });
  let cachedSectionPlanes: SectionPlaneData[] = [];

  const isClippedBySection = (pt: { x: number; y: number; z: number }): boolean =>
    isPointClipped(pt, cachedSectionPlanes);

  const sameItem = (a: ItemId | null, b: ItemId | null): boolean => {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.modelId === b.modelId && a.localId === b.localId;
  };

  const isSelected = (item: ItemId): boolean => {
    const sel = ctxRef?.plugins.get<SelectionShape>('selection');
    return sel?.hasItem(item) ?? false;
  };

  const modelOf = (item: ItemId) => ctxRef?.models().get(item.modelId);

  // Synchronous: we fire setColor/resetColor without awaiting. The
  // library's MeshConnection batches these inside one tile-update cycle,
  // so paying for sequential `await`s only delays the visual.
  const apply = (next: ItemId | null): void => {
    if (!ctxRef) return;
    if (sameItem(next, current)) return;
    current = next;

    // Always clear what we previously painted.
    if (painted) {
      void modelOf(painted)?.resetColor([painted.localId]).catch(() => undefined);
      edges.remove(ctxRef, [painted]);
      painted = null;
    }

    // Paint new only if eligible (enabled + not already selected).
    if (next && enabled && !isSelected(next)) {
      void modelOf(next)?.setColor([next.localId], color).catch(() => undefined);
      void edges.add(ctxRef, [next], color);
      painted = next;
    }

    ctxRef.events.emit('hover:change', { item: next });
  };

  // If the currently-hovered item gets selected, the selection plugin
  // will paint over our color. Drop our `painted` tracking so we don't
  // resetColor over selection on the next move. If a selected item is
  // deselected and the pointer is still on it, paint hover.
  const handleSelectionChange = (added: ItemId[], removed: ItemId[]): void => {
    if (!ctxRef) return;
    if (painted && added.some((a) => sameItem(a, painted))) {
      // Selection took over the color; let it. Drop our edge overlay
      // (selection has its own).
      edges.remove(ctxRef, [painted]);
      painted = null;
    }
    if (current && !painted && removed.some((r) => sameItem(r, current)) && !isSelected(current) && enabled) {
      void modelOf(current)?.setColor([current.localId], color).catch(() => undefined);
      void edges.add(ctxRef, [current], color);
      painted = current;
    }
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
      if (current) apply(null);
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
        const item = hit && !isClippedBySection(hit.point) ? hit.item : null;
        apply(item);
      }
    } finally {
      inFlight = false;
    }
  };

  return {
    name: NAME,
    optionalDependencies: ['selection'],

    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      if (!enabled && current) apply(null);
      ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
    },
    isEnabled() {
      return enabled;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      // Listen for selection changes so hover and selection stay in sync
      // on shared items without coordinating through a layered manager.
      ctx.events.on('selection:change', ({ added, removed }) => {
        handleSelectionChange(added, removed);
      });

      ctx.events.on('section:change', ({ planes }) => {
        cachedSectionPlanes = planes;
      });

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

      ctx.commands.register('hover.setEnabled', (args: unknown) => {
        const on = typeof args === 'boolean' ? args : (args as { enabled?: boolean })?.enabled;
        if (typeof on === 'boolean') {
          if (enabled === on) return enabled;
          enabled = on;
          if (!enabled && current) apply(null);
          ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
        }
        return enabled;
      }, { title: 'Enable/disable hover feature' });
      ctx.commands.register('hover.isEnabled', () => enabled, {
        title: 'Get hover enabled state',
      });
    },

    uninstall() {
      if (ctxRef) {
        if (painted) {
          void modelOf(painted)?.resetColor([painted.localId]).catch(() => undefined);
        }
        edges.dispose(ctxRef);
      }
      current = null;
      painted = null;
      pending = null;
      inFlight = false;
      cachedSectionPlanes = [];
      ctxRef = null;
    },
  };
}
