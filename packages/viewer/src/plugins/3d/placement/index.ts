/**
 * Placement plugin — a modal "drop a point" tool for capturing a new anchor by
 * tapping the model. It's the touch-first counterpart to the right-click
 * context menu: the portal opens its new-finding flow from `contextmenu:open`'s
 * `point`, which has no mouse on a phone. Placement mode makes a single tap do
 * the same thing.
 *
 * On enter it swaps the `click:left` mouse binding from `selection.pickSet` to
 * `placement.pick` (snapshotting whatever was bound, like the eraser) and clears
 * the current selection; on exit it restores the saved binding. Each tap while
 * active raycasts the model and emits `point:picked` with the world-space hit
 * point and the element under it — the same `{ point, item }` shape the
 * `contextmenu:open` event already carries, so hosts reuse their anchor wiring.
 *
 * `enter({ oneShot: true })` exits automatically after the first successful pick
 * (a tap that hits nothing is ignored and keeps the tool active) — the natural
 * mode for the mobile bridge's "place one finding" gesture. Default is sticky
 * (stays active until `placement.exit`), matching the eraser.
 */

import { pick } from '../../../core/Raycaster.js';
import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'placement' as const;

export interface PlacementPluginAPI {
  isActive(): boolean;
}

export interface PlacementEnterArgs {
  /** Exit automatically after the first successful pick. Default: false. */
  oneShot?: boolean;
  /**
   * Keep the current selection instead of clearing it on enter. Default: false.
   * The portal's "update finding pin" flow sets this: the inspector is scoped to
   * the selected element, so clearing the selection would re-scope the panel and
   * unmount the open finding mid-pick.
   */
  keepSelection?: boolean;
}

export function placementPlugin(): Plugin & PlacementPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let oneShot = false;
  let savedBinding: string | null = null;

  const enter = async (args: unknown): Promise<void> => {
    if (!ctxRef || active) return;
    const a = args as PlacementEnterArgs | undefined;
    oneShot = a?.oneShot ?? false;
    const keepSelection = a?.keepSelection ?? false;

    const bindings = await ctxRef.commands.execute<
      undefined,
      Array<{ gesture: string; command: string }>
    >('mouseBindings.list');
    const current = bindings?.find((b) => b.gesture === 'click:left');
    savedBinding = current?.command ?? 'selection.pickSet';

    await ctxRef.commands.execute('mouseBindings.bind', {
      gesture: 'click:left',
      command: 'placement.pick',
    });
    if (!keepSelection) {
      await ctxRef.commands.execute('selection.clear').catch(() => undefined);
    }

    active = true;
    ctxRef.events.emit('placement:change', { active: true });
  };

  const exit = async (): Promise<void> => {
    if (!ctxRef || !active) return;

    await ctxRef.commands.execute('mouseBindings.bind', {
      gesture: 'click:left',
      command: savedBinding ?? 'selection.pickSet',
    });

    active = false;
    savedBinding = null;
    oneShot = false;
    ctxRef.events.emit('placement:change', { active: false });
  };

  type PickArgs = { ndc?: { x: number; y: number } | null } | null | undefined;

  const pickPoint = async (args: unknown): Promise<void> => {
    if (!ctxRef || !active) return;
    const ndc = (args as PickArgs)?.ndc;
    if (!ndc) return;

    const hit = await pick(ctxRef, ndc);
    if (!hit) return; // tap missed the model — stay armed, no anchor.

    ctxRef.events.emit('point:picked', {
      point: hit.point,
      item: hit.item,
    });

    // One-shot mode: a successful pick ends the tool (the host then opens its
    // anchored form). A missed tap above never reaches here, so the user keeps
    // tapping until they land on geometry.
    if (oneShot) await exit();
  };

  return {
    name: NAME,
    dependencies: ['mouse-bindings', 'selection'],

    isActive() {
      return active;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('placement.pick', (args: unknown) => pickPoint(args), {
        title: 'Pick a placement point under the cursor',
      });

      ctx.commands.register('placement.enter', (args: unknown) => enter(args), {
        title: 'Activate point-placement tool',
      });

      ctx.commands.register('placement.exit', () => exit(), {
        title: 'Deactivate point-placement tool',
      });

      ctx.commands.register(
        'placement.toggle',
        async (args: unknown) => {
          if (active) await exit();
          else await enter(args);
        },
        { title: 'Toggle point-placement tool' },
      );

      ctx.commands.register('placement.isActive', () => active, {
        title: 'Check if point-placement is active',
      });
    },

    async uninstall() {
      if (active && ctxRef) {
        await exit();
      }
      ctxRef = null;
    },
  };
}
