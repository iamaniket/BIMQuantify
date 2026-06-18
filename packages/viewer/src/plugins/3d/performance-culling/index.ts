/**
 * performance-culling — thin command surface over the viewer's native
 * frustum-culling policy.
 *
 * The heavy lifting lives in the `Viewer` itself (it owns the per-model
 * `LodMode` application *and* the contact-shadow bake that must temporarily
 * un-cull). This plugin only exposes `performance.setCulling` so the portal's
 * viewer settings can drive the policy like any other toggle — mirroring how
 * the spaces toggle drives `visibility.setTypeVisible`.
 *
 * Commands:
 *   - `performance.setCulling` `{ mode: 'auto' | 'on' | 'off' }`
 *       Set the policy. `auto` culls federated/large scenes only; `on` always
 *       culls; `off` draws everything (legacy behaviour).
 */

import type { CullingMode, Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'performance-culling' as const;

const isCullingMode = (v: unknown): v is CullingMode =>
  v === 'auto' || v === 'on' || v === 'off';

export function performanceCullingPlugin(): Plugin {
  return {
    name: NAME,
    install(ctx: ViewerContext): void {
      ctx.commands.register<{ mode: CullingMode }, void>(
        'performance.setCulling',
        async (args) => {
          const mode = (args as { mode?: unknown } | undefined)?.mode;
          if (isCullingMode(mode)) await ctx.setCullingMode(mode);
        },
        { title: 'Set frustum-culling policy (auto/on/off)' },
      );
    },
  };
}
