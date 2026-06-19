/**
 * Interaction plugin (3D) — a reusable "arm a pick" capability that dims the app
 * and tells the user what to click. It does NOT raycast: it composes the
 * `placement` plugin (one-shot tap → `point:picked`) and layers the shared scrim
 * + instruction banner on top so the only clickable thing is the model.
 *
 * Lifecycle (its overlay is a strict subset of placement's active window):
 *   `interaction.request({ message, hint?, cursor?, blockedSelectors? })`
 *     → mount overlay, then `placement.enter({ oneShot: true })`.
 *   A successful tap fires `point:picked` (placement also exits itself in
 *     one-shot) → tear down overlay, emit `interaction:resolved`.
 *   Esc / the banner × button, or any external `placement.exit`
 *     → tear down overlay, emit `interaction:cancelled`.
 *
 * The message is supplied already-translated by the caller — this plugin is
 * string-agnostic (the viewer package carries no i18n catalog).
 */

import type { Plugin, ViewerContext } from '../../../core/types.js';
import {
  mountInteractionOverlay,
  type InteractionPluginAPI,
  type OverlayController,
} from '../../shared/interaction-overlay/overlay-dom.js';

const NAME = 'interaction' as const;

export interface InteractionRequestArgs {
  /** Instruction text shown in the banner — already translated. */
  message: string;
  hint?: string;
  cursor?: string;
  /** Selectors re-covered by the scrim where they overlap the viewport. */
  blockedSelectors?: string[];
}

interface ModeView {
  mode(): 'normal' | 'edit';
}

export function interactionPlugin(): Plugin & InteractionPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: OverlayController | null = null;
  let armed = false;
  const subs: Array<() => void> = [];

  const teardown = (): void => {
    armed = false;
    for (const off of subs.splice(0)) off();
    overlay?.destroy();
    overlay = null;
  };

  const cancel = async (): Promise<void> => {
    if (!ctxRef || !armed) return;
    const ctx = ctxRef;
    teardown();
    await ctx.commands.execute('placement.exit').catch(() => undefined);
    ctx.events.emit('interaction:cancelled', undefined);
  };

  const request = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    if (armed) await cancel();
    const ctx = ctxRef;
    const a = (args ?? {}) as Partial<InteractionRequestArgs>;

    // A live edit tool (measurement/section) also owns the left-click; drop out
    // of edit mode first so the two don't fight over the gesture.
    const mode = ctx.plugins.get<ModeView>('mode');
    if (mode && mode.mode() === 'edit') {
      await ctx.commands.execute('mode.exit').catch(() => undefined);
    }

    armed = true;
    overlay = mountInteractionOverlay(ctx.container, {
      message: a.message ?? '',
      ...(a.hint ? { hint: a.hint } : {}),
      ...(a.cursor ? { cursor: a.cursor } : {}),
      ...(a.blockedSelectors ? { blockedSelectors: a.blockedSelectors } : {}),
      onCancel: () => {
        void cancel();
      },
    });

    subs.push(
      ctx.events.on('point:picked', (evt) => {
        if (!armed) return;
        teardown();
        ctx.events.emit('interaction:resolved', {
          kind: 'point',
          point: evt.point,
          item: evt.item,
        });
      }),
    );
    // Placement exited without a pick (external cancel / tool switch) — mirror it
    // as a cancellation. A successful pick already cleared `armed` above, so this
    // is skipped in the resolve path.
    subs.push(
      ctx.events.on('placement:change', (evt) => {
        if (!armed || evt.active) return;
        teardown();
        ctx.events.emit('interaction:cancelled', undefined);
      }),
    );

    await ctx.commands.execute('placement.enter', { oneShot: true });
  };

  return {
    name: NAME,
    dependencies: ['placement'],

    isActive() {
      return armed;
    },

    install(ctx: ViewerContext) {
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

    async uninstall() {
      if (armed) await cancel();
      teardown();
      ctxRef = null;
    },
  };
}
