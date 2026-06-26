import type { Plugin, ViewerContext } from '@bimdossier/viewer';

/**
 * Forces the whole-model "monochrome" material look for the marketing showcase.
 * `setActiveLook` is a core Viewer method (not the display-mode plugin), so this
 * needs none of that plugin's dependencies. Set at install — before the model
 * streams in — so every material inherits monochrome via the `onItemSet` hook
 * and there's no color→mono flash on load.
 */
export function monochromeLookPlugin(): Plugin {
  return {
    name: 'web-monochrome-look',
    install(ctx: ViewerContext): void {
      ctx.setActiveLook('monochrome');
      ctx.requestRender();
    },
  };
}
