/**
 * Interaction plugin (2D) — the document-engine counterpart to the 3D
 * `interaction` plugin. Same shape, same shared scrim + banner, but it composes
 * `entity-marker-2d` instead of `placement` for the actual pick.
 *
 * Lifecycle:
 *   `interaction.request({ message, hint?, cursor?, blockedSelectors?, placeType? })`
 *     → mount overlay, then `entity-marker-2d.beginPlace({ type })`.
 *   A click on the drawing fires `entity-marker:place` (the marker plugin ends
 *     placement itself after one drop) → tear down overlay, emit
 *     `interaction:resolved` with the normalized page point.
 *   Esc / the banner × button → `entity-marker-2d.endPlace`, tear down overlay,
 *     emit `interaction:cancelled`.
 *
 * Registered on both `DocumentViewer` (PDF) and `FloorPlanViewer` (floor plans),
 * which share the `DocumentContext` engine and both seed `entity-marker-2d`.
 */

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';
import type { EntityMarker2DType } from '../entity-marker/index.js';
import {
  mountInteractionOverlay,
  type InteractionPluginAPI,
  type OverlayController,
} from '../../shared/interaction-overlay/overlay-dom.js';

const NAME = 'interaction' as const;

export interface Interaction2DRequestArgs {
  /** Instruction text shown in the banner — already translated. */
  message: string;
  hint?: string;
  cursor?: string;
  /** Selectors re-covered by the scrim where they overlap the viewport. */
  blockedSelectors?: string[];
  /** Marker glyph kind to place. Default `'finding'`. */
  placeType?: EntityMarker2DType;
}

export function interaction2DPlugin(): DocumentPlugin & InteractionPluginAPI {
  let ctxRef: DocumentContext | null = null;
  let overlay: OverlayController | null = null;
  let armed = false;
  const subs: Array<() => void> = [];

  const teardown = (): void => {
    armed = false;
    for (const off of subs.splice(0)) off();
    overlay?.destroy();
    overlay = null;
  };

  const cancel = (): void => {
    if (!ctxRef || !armed) return;
    const ctx = ctxRef;
    teardown();
    void ctx.commands.execute('entity-marker-2d.endPlace').catch(() => undefined);
    ctx.events.emit('interaction:cancelled', undefined);
  };

  const request = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    if (armed) cancel();
    const ctx = ctxRef;
    const a = (args ?? {}) as Partial<Interaction2DRequestArgs>;

    armed = true;
    overlay = mountInteractionOverlay(ctx.container, {
      message: a.message ?? '',
      ...(a.hint ? { hint: a.hint } : {}),
      ...(a.cursor ? { cursor: a.cursor } : {}),
      ...(a.blockedSelectors ? { blockedSelectors: a.blockedSelectors } : {}),
      onCancel: () => {
        cancel();
      },
    });

    subs.push(
      ctx.events.on('entity-marker:place', (evt) => {
        if (!armed) return;
        teardown();
        ctx.events.emit('interaction:resolved', {
          kind: 'page',
          x: evt.x,
          y: evt.y,
          page: evt.page,
        });
      }),
    );

    await ctx.commands.execute('entity-marker-2d.beginPlace', {
      type: a.placeType ?? 'finding',
    });
  };

  return {
    name: NAME,
    dependencies: ['entity-marker-2d'],

    isActive() {
      return armed;
    },

    install(ctx: DocumentContext) {
      ctxRef = ctx;

      ctx.commands.register('interaction.request', (args: unknown) => request(args), {
        title: 'Arm a guided pick with a dimming overlay + instruction banner',
      });
      ctx.commands.register('interaction.cancel', () => cancel(), {
        title: 'Cancel the active guided pick',
      });
      ctx.commands.register('interaction.isActive', () => armed, {
        title: 'Check if a guided pick is active',
      });
    },

    uninstall() {
      if (armed) cancel();
      teardown();
      ctxRef = null;
    },
  };
}
