/**
 * A `Hider`-shaped facade over the viewer's own `ctx.models()`. `set` mutates
 * visibility only — NO flush/render. Callers run exactly one `flush()` after
 * they have emitted `visibility:change`, so geometry and outline change in the
 * same painted frame.
 *
 * We deliberately do NOT use OBC's `Hider` component: `Hider` reads
 * `components.get(FragmentsManager).list`, but this viewer loads every model
 * into its own FragmentsModels (`ctx.fragments`), never into the OBC
 * FragmentsManager — so that list is always empty and every `Hider` call is a
 * silent no-op (which is exactly what broke the spaces toggle). This helper
 * mirrors Hider's API over the models the viewer owns.
 */

import type { ViewerContext } from '../../../core/types.js';

export interface ModelHider {
  set(visible: boolean, modelIdMap?: Record<string, Set<number>>): Promise<void>;
  isolate(modelIdMap: Record<string, Set<number>>): Promise<void>;
  getVisibilityMap(state: boolean): Promise<Record<string, number[]>>;
  flush(): Promise<void>;
}

export function createModelHider(ctx: ViewerContext): ModelHider {
  const set = async (
    visible: boolean,
    modelIdMap?: Record<string, Set<number>>,
  ): Promise<void> => {
    const models = ctx.models();
    if (modelIdMap) {
      for (const [modelId, ids] of Object.entries(modelIdMap)) {
        const model = models.get(modelId);
        if (!model) continue;
        await model.setVisible([...ids], visible).catch(() => undefined);
      }
    } else {
      for (const model of models.values()) {
        await model.setVisible(undefined, visible).catch(() => undefined);
      }
    }
  };

  return {
    set,
    // Hide everything, then re-show the kept set. Sequential (not Hider's
    // parallel) so the kept items deterministically win and end up visible.
    // No flush here — the caller flushes once after emitting the change.
    async isolate(modelIdMap) {
      await set(false);
      await set(true, modelIdMap);
    },
    async getVisibilityMap(state) {
      const out: Record<string, number[]> = {};
      for (const [modelId, model] of ctx.models()) {
        out[modelId] = await model.getItemsByVisibility(state).catch(() => []);
      }
      return out;
    },
    // Drain the accumulated visibility changes to the GPU and draw them once —
    // the viewer renders on-demand, so a silent setVisible would otherwise not
    // show until the next interaction.
    async flush() {
      await ctx.fragments.update(true).catch(() => undefined);
      ctx.requestRender();
    },
  };
}
