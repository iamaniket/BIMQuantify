/**
 * Tiny typed event emitter. Drives all viewer ↔ plugin and viewer ↔ host
 * communication. No deps, no inheritance, no wildcards — keep it boring.
 */

export type Unsubscribe = () => void;

type Handler<T> = (payload: T) => void;

export class EventBus<TMap> {
  private handlers = new Map<keyof TMap, Set<Handler<unknown>>>();

  on<K extends keyof TMap>(key: K, handler: Handler<TMap[K]>): Unsubscribe {
    let set = this.handlers.get(key);
    if (!set) {
      set = new Set();
      this.handlers.set(key, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(key, handler);
  }

  off<K extends keyof TMap>(key: K, handler: Handler<TMap[K]>): void {
    this.handlers.get(key)?.delete(handler as Handler<unknown>);
  }

  once<K extends keyof TMap>(key: K, handler: Handler<TMap[K]>): Unsubscribe {
    const wrapped: Handler<TMap[K]> = (payload) => {
      this.off(key, wrapped);
      handler(payload);
    };
    return this.on(key, wrapped);
  }

  emit<K extends keyof TMap>(key: K, payload: TMap[K]): void {
    const set = this.handlers.get(key);
    if (!set || set.size === 0) return;
    // Snapshot to allow handlers to unsubscribe during dispatch without
    // mutating the iterating set.
    for (const handler of [...set]) {
      try {
        (handler as Handler<TMap[K]>)(payload);
      } catch (err) {
        // Don't let one broken handler break the chain. Surface to console
        // so the bug is visible without taking down other plugins.
        console.error(`[viewer] handler for "${String(key)}" threw:`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}
