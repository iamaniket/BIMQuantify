import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { hoverHighlightPlugin } from './index';

/**
 * Hover highlight has two independent gates: `userEnabled` (the persistent
 * settings toggle — the single source of truth) and `paused` (transient motion
 * suppression driven by interactive-performance). These tests pin the contract
 * that matters for the regression: a transient pause/resume must never override
 * the user's choice, and only genuine user toggles emit `feature:enabled`.
 *
 * No GPU: the one model's `raycast` returns a fixed hit and `setColor`/
 * `resetColor` are spies. The edge overlay is fire-and-forget and bails when the
 * outline cache is absent, so it's harmless here.
 */

function fakeModel() {
  const setColor = vi.fn(() => Promise.resolve());
  const resetColor = vi.fn(() => Promise.resolve());
  return {
    raycast: () =>
      Promise.resolve({ localId: 7, point: new THREE.Vector3(1, 2, 3), distance: 1 }),
    setColor,
    resetColor,
  };
}

function makeCtx(model: ReturnType<typeof fakeModel>): {
  ctx: ViewerContext;
  commands: CommandRegistry;
  events: EventBus<ViewerEvents>;
  model: ReturnType<typeof fakeModel>;
} {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const models = new Map<string, ReturnType<typeof fakeModel>>([['file-1', model]]);

  const ctx = {
    camera: {},
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    },
    scene: { add: vi.fn(), remove: vi.fn() },
    renderer: { getSize: (v: THREE.Vector2) => v.set(100, 100) },
    getBasePixelRatio: () => 1,
    models: () => models,
    // No selection plugin — `isSelected` resolves false.
    plugins: { get: () => undefined },
    commands,
    events,
  } as unknown as ViewerContext;

  return { ctx, commands, events, model };
}

const NDC = { ndc: { x: 0, y: 0 } };

describe('hover-highlight plugin — user-enabled vs paused axes', () => {
  it('paints on hover when enabled and not paused', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    hoverHighlightPlugin().install(ctx);

    await commands.execute('hover.pick', NDC);

    expect(model.setColor).toHaveBeenCalledWith([7], expect.anything());
  });

  it('does not paint while paused, and repaints once resumed', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    const plugin = hoverHighlightPlugin();
    plugin.install(ctx);

    plugin.setPaused(true);
    await commands.execute('hover.pick', NDC);
    expect(model.setColor).not.toHaveBeenCalled();

    plugin.setPaused(false);
    await commands.execute('hover.pick', NDC);
    expect(model.setColor).toHaveBeenCalledWith([7], expect.anything());
  });

  it('stays off after a pause/resume cycle when the user disabled hover', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    const plugin = hoverHighlightPlugin();
    plugin.install(ctx);

    // User turns hover off — the single source of truth.
    plugin.setEnabled(false);

    // A camera orbit pauses then resumes hover. Resume must NOT re-enable it.
    plugin.setPaused(true);
    plugin.setPaused(false);

    await commands.execute('hover.pick', NDC);
    expect(model.setColor).not.toHaveBeenCalled();
    expect(plugin.isEnabled()).toBe(false);
  });

  it('reports the user setting from isEnabled(), independent of pause', async () => {
    const { ctx } = makeCtx(fakeModel());
    const plugin = hoverHighlightPlugin();
    plugin.install(ctx);

    plugin.setPaused(true);
    expect(plugin.isEnabled()).toBe(true);

    plugin.setEnabled(false);
    plugin.setPaused(false);
    expect(plugin.isEnabled()).toBe(false);
  });

  it('clears the current highlight when the user disables hover mid-hover', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    const plugin = hoverHighlightPlugin();
    plugin.install(ctx);

    await commands.execute('hover.pick', NDC);
    expect(model.setColor).toHaveBeenCalled();

    plugin.setEnabled(false);
    expect(model.resetColor).toHaveBeenCalledWith([7]);
  });

  it('emits feature:enabled only for user toggles, never for transient pause', async () => {
    const { ctx } = makeCtx(fakeModel());
    const plugin = hoverHighlightPlugin();
    plugin.install(ctx);

    const events: boolean[] = [];
    ctx.events.on('feature:enabled', ({ name, enabled }) => {
      if (name === 'hover-highlight') events.push(enabled);
    });

    plugin.setPaused(true);
    plugin.setPaused(false);
    expect(events).toEqual([]);

    plugin.setEnabled(false);
    plugin.setEnabled(true);
    expect(events).toEqual([false, true]);
  });

  it('honors the initial enabled:false option at construction', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    hoverHighlightPlugin({ enabled: false }).install(ctx);

    await commands.execute('hover.pick', NDC);
    expect(model.setColor).not.toHaveBeenCalled();
  });

  it('exposes hover.setPaused / hover.setEnabled as commands that gate painting', async () => {
    const { ctx, commands, model } = makeCtx(fakeModel());
    hoverHighlightPlugin().install(ctx);

    await commands.execute('hover.setPaused', true);
    await commands.execute('hover.pick', NDC);
    expect(model.setColor).not.toHaveBeenCalled();

    await commands.execute('hover.setPaused', false);
    await commands.execute('hover.pick', NDC);
    expect(model.setColor).toHaveBeenCalledWith([7], expect.anything());
  });
});
