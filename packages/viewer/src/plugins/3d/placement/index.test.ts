import { describe, expect, it } from 'vitest';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ItemId, ViewerContext, ViewerEvents } from '../../../core/types';
import { placementPlugin } from './index';

/**
 * Placement is a binding-swap tool like the eraser: enter snapshots and rebinds
 * `click:left` to `placement.pick`, a tap raycasts and emits `point:picked`, and
 * exit restores the saved binding. These tests cover that state machine plus the
 * `oneShot` auto-exit — without a GPU, by faking the one model `pick` raycasts.
 */

interface BindCall {
  gesture: string;
  command: string;
}

/** A model whose raycast returns a fixed hit (or a miss when `hit` is null). */
function fakeModel(hit: { localId: number; point: { x: number; y: number; z: number } } | null) {
  return {
    raycast: () =>
      Promise.resolve(
        hit ? { localId: hit.localId, point: hit.point, distance: 1 } : null,
      ),
  };
}

function makeCtx(model: ReturnType<typeof fakeModel> | null): {
  ctx: ViewerContext;
  commands: CommandRegistry;
  events: EventBus<ViewerEvents>;
  bindCalls: BindCall[];
  clearedSelection: () => boolean;
} {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const bindCalls: BindCall[] = [];
  let selectionCleared = false;

  // What the plugin reaches for. `mouseBindings.list` seeds the saved binding;
  // `bind` records swaps; `selection.clear` is observed.
  commands.register('mouseBindings.list', () => [
    { gesture: 'click:left', command: 'selection.pickSet' },
  ]);
  commands.register('mouseBindings.bind', (args: unknown) => {
    bindCalls.push(args as BindCall);
  });
  commands.register('selection.clear', () => {
    selectionCleared = true;
  });

  const models = new Map<string, ReturnType<typeof fakeModel>>();
  if (model) models.set('file-1', model);

  const ctx = {
    camera: {},
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    },
    models: () => models,
    commands,
    events,
  } as unknown as ViewerContext;

  return { ctx, commands, events, bindCalls, clearedSelection: () => selectionCleared };
}

describe('placement plugin', () => {
  it('rebinds click:left, clears selection, and emits placement:change on enter', async () => {
    const { ctx, commands, events, bindCalls, clearedSelection } = makeCtx(null);
    const plugin = placementPlugin();
    plugin.install(ctx);

    const changes: boolean[] = [];
    events.on('placement:change', ({ active }) => changes.push(active));

    await commands.execute('placement.enter');

    expect(plugin.isActive()).toBe(true);
    expect(bindCalls).toContainEqual({ gesture: 'click:left', command: 'placement.pick' });
    expect(clearedSelection()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('restores the saved click:left binding on exit', async () => {
    const { ctx, commands, bindCalls } = makeCtx(null);
    const plugin = placementPlugin();
    plugin.install(ctx);

    await commands.execute('placement.enter');
    await commands.execute('placement.exit');

    expect(plugin.isActive()).toBe(false);
    // Last bind restores the snapshot captured from mouseBindings.list.
    expect(bindCalls.at(-1)).toEqual({ gesture: 'click:left', command: 'selection.pickSet' });
  });

  it('emits point:picked with the world hit + item on a successful pick', async () => {
    const { ctx, commands, events } = makeCtx(fakeModel({ localId: 42, point: { x: 1, y: 2, z: 3 } }));
    const plugin = placementPlugin();
    plugin.install(ctx);

    const picked: Array<{ point: { x: number; y: number; z: number }; item: ItemId | null }> = [];
    events.on('point:picked', (p) => picked.push(p));

    await commands.execute('placement.enter');
    await commands.execute('placement.pick', { ndc: { x: 0, y: 0 } });

    expect(picked).toHaveLength(1);
    expect(picked[0]!.point).toEqual({ x: 1, y: 2, z: 3 });
    expect(picked[0]!.item).toEqual({ modelId: 'file-1', localId: 42 });
    // Sticky by default — still active after a pick.
    expect(plugin.isActive()).toBe(true);
  });

  it('auto-exits after the first successful pick in oneShot mode', async () => {
    const { ctx, commands, events } = makeCtx(fakeModel({ localId: 7, point: { x: 0, y: 0, z: 0 } }));
    const plugin = placementPlugin();
    plugin.install(ctx);

    const picked: unknown[] = [];
    events.on('point:picked', (p) => picked.push(p));

    await commands.execute('placement.enter', { oneShot: true });
    await commands.execute('placement.pick', { ndc: { x: 0, y: 0 } });

    expect(picked).toHaveLength(1);
    expect(plugin.isActive()).toBe(false);
  });

  it('ignores a tap that misses the model and stays armed', async () => {
    const { ctx, commands, events } = makeCtx(fakeModel(null));
    const plugin = placementPlugin();
    plugin.install(ctx);

    const picked: unknown[] = [];
    events.on('point:picked', (p) => picked.push(p));

    await commands.execute('placement.enter', { oneShot: true });
    await commands.execute('placement.pick', { ndc: { x: 0, y: 0 } });

    expect(picked).toHaveLength(0);
    expect(plugin.isActive()).toBe(true);
  });

  it('toggle flips active state', async () => {
    const { ctx, commands } = makeCtx(null);
    const plugin = placementPlugin();
    plugin.install(ctx);

    await commands.execute('placement.toggle');
    expect(plugin.isActive()).toBe(true);
    await commands.execute('placement.toggle');
    expect(plugin.isActive()).toBe(false);
  });
});
