/**
 * Hover-highlight plugin. Listens for pointer movement on the canvas,
 * raycasts on a rAF tick, applies a translucent highlight to the picked
 * item, and emits `hover:change`. Selection takes priority — we don't
 * highlight already-selected items (avoids material flicker).
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';

import { clientToNdc, pick } from '../../core/Raycaster.js';
import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'hover-highlight' as const;

interface HoverPluginOptions {
  /** Highlight color. Default: light blue. */
  color?: number;
  /** Opacity (0–1). Default: 0.5. */
  opacity?: number;
}

export function hoverHighlightPlugin(options: HoverPluginOptions = {}): Plugin {
  const color = new THREE.Color(options.color ?? 0x6cb4ff);
  const opacity = options.opacity ?? 0.5;

  let cleanup: (() => void) | null = null;

  return {
    name: NAME,

    install(ctx: ViewerContext) {
      const canvas = ctx.canvas;
      let pendingNdc: { x: number; y: number } | null = null;
      let raf = 0;
      let current: ItemId | null = null;
      let inFlight = false;

      const material: FRAGS.MaterialDefinition = {
        color,
        opacity,
        transparent: opacity < 1,
        renderedFaces: FRAGS.RenderedFaces.TWO,
        customId: 'hover',
      };

      const isSelected = (item: ItemId): boolean => {
        if (!ctx.commands.has('selection.has')) return false;
        // synchronous-ish: selection plugin's `has` returns boolean directly.
        // CommandRegistry returns Promise<R>; we accept a microtask delay,
        // but here we do a fast best-effort check via the plugin instance.
        const sel = ctx.plugins.get<{ hasItem(i: ItemId): boolean }>('selection');
        return sel?.hasItem(item) ?? false;
      };

      const apply = async (next: ItemId | null): Promise<void> => {
        if (sameItem(next, current)) return;
        const prev = current;
        current = next;
        if (prev) {
          const model = ctx.models().get(prev.modelId);
          await model?.resetHighlight([prev.localId]).catch(() => undefined);
        }
        if (next && !isSelected(next)) {
          const model = ctx.models().get(next.modelId);
          await model?.highlight([next.localId], material).catch(() => undefined);
        }
        ctx.events.emit('hover:change', { item: next });
      };

      const tick = async (): Promise<void> => {
        raf = 0;
        if (inFlight) {
          // re-schedule — coalesce while a previous pick is mid-flight.
          if (pendingNdc) raf = requestAnimationFrame(() => void tick());
          return;
        }
        const ndc = pendingNdc;
        pendingNdc = null;
        if (!ndc) return;
        inFlight = true;
        try {
          const hit = await pick(ctx, ndc);
          await apply(hit?.item ?? null);
        } finally {
          inFlight = false;
          if (pendingNdc) raf = requestAnimationFrame(() => void tick());
        }
      };

      const onMove = (ev: PointerEvent): void => {
        const ndc = clientToNdc(canvas, ev.clientX, ev.clientY);
        pendingNdc = ndc;
        ctx.events.emit('pointer:move', {
          ndc,
          clientX: ev.clientX,
          clientY: ev.clientY,
        });
        if (!raf) raf = requestAnimationFrame(() => void tick());
      };

      const onLeave = (): void => {
        pendingNdc = null;
        if (current) void apply(null);
      };

      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerleave', onLeave);

      cleanup = (): void => {
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerleave', onLeave);
        if (raf) cancelAnimationFrame(raf);
        if (current) {
          const model = ctx.models().get(current.modelId);
          model?.resetHighlight([current.localId]).catch(() => undefined);
        }
        current = null;
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
    },
  };
}

function sameItem(a: ItemId | null, b: ItemId | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.modelId === b.modelId && a.localId === b.localId;
}
