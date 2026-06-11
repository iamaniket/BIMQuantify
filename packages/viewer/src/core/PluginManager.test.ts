import { describe, expect, it } from 'vitest';

import { CommandRegistry } from './CommandRegistry';
import { EventBus } from './EventBus';
import { PluginManager, type Plugin, type PluginLifecycleEvents } from './plugin';

type TestEvents = PluginLifecycleEvents;

function makeManager(): PluginManager<object, TestEvents> {
  return new PluginManager<object, TestEvents>({}, new CommandRegistry(), new EventBus<TestEvents>());
}

interface PluginOpts {
  dependencies?: string[];
  optionalDependencies?: string[];
  onInstall?: () => void;
}

function makePlugin(name: string, opts: PluginOpts = {}): Plugin<object> {
  return {
    name,
    ...(opts.dependencies ? { dependencies: opts.dependencies } : {}),
    ...(opts.optionalDependencies ? { optionalDependencies: opts.optionalDependencies } : {}),
    install() {
      opts.onInstall?.();
    },
  };
}

describe('PluginManager dependency resolution', () => {
  it('throws when a hard dependency is missing', async () => {
    const pm = makeManager();
    await expect(pm.register(makePlugin('b', { dependencies: ['a'] }))).rejects.toThrow(
      /depends on "a"/,
    );
    expect(pm.has('b')).toBe(false);
  });

  it('installs a hard dependency chain in registration order', async () => {
    const pm = makeManager();
    const order: string[] = [];
    await pm.register(makePlugin('a', { onInstall: () => order.push('a') }));
    await pm.register(makePlugin('b', { dependencies: ['a'], onInstall: () => order.push('b') }));
    expect(order).toEqual(['a', 'b']);
    expect(pm.has('b')).toBe(true);
  });

  it('installs fine when an optional dependency is absent', async () => {
    const pm = makeManager();
    await expect(
      pm.register(makePlugin('p', { optionalDependencies: ['x'] })),
    ).resolves.toBeUndefined();
    expect(pm.has('p')).toBe(true);
  });

  it('installs fine when an optional dependency is already present', async () => {
    const pm = makeManager();
    await pm.register(makePlugin('x'));
    await pm.register(makePlugin('p', { optionalDependencies: ['x'] }));
    expect(pm.has('p')).toBe(true);
    expect(pm.has('x')).toBe(true);
  });

  it('tolerates an optional dependency that registers later (no ordering mandate)', async () => {
    const pm = makeManager();
    await pm.register(makePlugin('p', { optionalDependencies: ['x'] }));
    await pm.register(makePlugin('x'));
    expect(pm.has('p')).toBe(true);
    expect(pm.has('x')).toBe(true);
  });

  it('blocks unregistering a hard dependency while a dependent is installed', async () => {
    const pm = makeManager();
    await pm.register(makePlugin('a'));
    await pm.register(makePlugin('b', { dependencies: ['a'] }));
    await expect(pm.unregister('a')).rejects.toThrow(/depends on it/);
    expect(pm.has('a')).toBe(true);
  });

  it('allows unregistering an optional dependency while a soft dependent is installed', async () => {
    const pm = makeManager();
    await pm.register(makePlugin('x'));
    await pm.register(makePlugin('p', { optionalDependencies: ['x'] }));
    await expect(pm.unregister('x')).resolves.toBeUndefined();
    expect(pm.has('x')).toBe(false);
    expect(pm.has('p')).toBe(true);
  });
});
