import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewerEvents, ViewerHandle } from '@bimdossier/viewer';

import { toEntityKey, useViewerEntityStore } from '@/stores/viewerEntityStore';

import { useViewerBridge } from './useViewerBridge';

/**
 * Minimal stand-in for the viewer's `EventBus`: records `on` subscriptions and
 * lets the test drive them via `emit`. Structurally close enough to
 * `ViewerHandle['events']` that the assembled fake handle casts cleanly.
 */
class FakeEventBus {
  private handlers = new Map<string, Set<(payload: unknown) => void>>();

  on = (key: string, handler: (payload: unknown) => void): (() => void) => {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler);
    return () => this.off(key, handler);
  };

  off = (key: string, handler: (payload: unknown) => void): void => {
    this.handlers.get(key)?.delete(handler);
  };

  once = (key: string, handler: (payload: unknown) => void): (() => void) => {
    const wrapped = (payload: unknown): void => {
      this.off(key, wrapped);
      handler(payload);
    };
    return this.on(key, wrapped);
  };

  emit<K extends keyof ViewerEvents>(key: K, payload: ViewerEvents[K]): void {
    for (const handler of [...(this.handlers.get(key as string) ?? [])]) {
      handler(payload);
    }
  }
}

function makeHandle(): {
  handle: ViewerHandle;
  bus: FakeEventBus;
  execute: ReturnType<typeof vi.fn>;
} {
  const bus = new FakeEventBus();
  const execute = vi.fn().mockResolvedValue(undefined);
  const handle = {
    commands: { execute, has: () => true, list: () => [] },
    events: bus,
    plugins: { register: vi.fn(), unregister: vi.fn(), get: () => null },
    getModelId: () => null,
  } as unknown as ViewerHandle;
  return { handle, bus, execute };
}

// Let the bridge's deferred `_syncDepth` decrement (a `queueMicrotask`) run.
const flushMicrotasks = (): Promise<void> =>
  act(async () => {
    await Promise.resolve();
  });

const store = useViewerEntityStore;

describe('useViewerBridge echo suppression', () => {
  beforeEach(() => {
    store.getState()._reset();
  });

  it('viewer→store: mirrors a selection event without echoing a command back', async () => {
    const { handle, bus, execute } = makeHandle();
    renderHook(() => useViewerBridge(handle));

    act(() => {
      bus.emit('selection:change', {
        selected: [{ modelId: 'm', localId: 1 }],
        added: [{ modelId: 'm', localId: 1 }],
        removed: [],
        allSelected: false,
      });
    });

    // The store mirrors the viewer selection...
    expect(store.getState().selected.has(toEntityKey('m', 1))).toBe(true);
    // ...and the change is NOT bounced back to the viewer (it came FROM it).
    expect(execute).not.toHaveBeenCalled();

    // The guard disarms after the microtask, ready for real UI input.
    await flushMicrotasks();
    expect(store.getState()._syncDepth).toBe(0);
  });

  it('store→viewer: a user mutation dispatches exactly one command, even after the viewer echoes it', async () => {
    const { handle, bus, execute } = makeHandle();
    renderHook(() => useViewerBridge(handle));
    await flushMicrotasks();

    // User clicks a tree row → store mutation → exactly one command dispatched.
    act(() => {
      store.getState().select([toEntityKey('m', 1)]);
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('selection.set', [{ modelId: 'm', localId: 1 }]);

    // The viewer applies it and echoes `selection:change` back. The guard must
    // absorb the echo — no second `selection.set` dispatch.
    act(() => {
      bus.emit('selection:change', {
        selected: [{ modelId: 'm', localId: 1 }],
        added: [{ modelId: 'm', localId: 1 }],
        removed: [],
        allSelected: false,
      });
    });
    await flushMicrotasks();

    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.getState()._syncDepth).toBe(0);
  });
});
