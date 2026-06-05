/**
 * Mode-agnostic plugin system core. Both the 3D viewer (`ViewerContext` /
 * `ViewerEvents`) and the PDF document engine (`DocumentContext` /
 * `DocumentEvents`) build on these generics — only the context shape and the
 * event map differ. `EventBus` and `CommandRegistry` are already generic and
 * are reused as-is by both engines.
 *
 * The 3D viewer narrows `Plugin<TContext>` to `Plugin<ViewerContext>` and
 * `PluginManager<TContext, TEvents>` to a concrete class in
 * `./types.js` / `./PluginManager.js`, so the 34 existing 3D plugins and
 * `Viewer.ts` keep their current imports unchanged.
 */

import type { CommandRegistry } from './CommandRegistry.js';
import type { EventBus } from './EventBus.js';

/** Read-only view a plugin gets onto its sibling plugins. */
export interface PluginRegistryView {
  get<T = unknown>(name: string): T | null;
  has(name: string): boolean;
}

/**
 * A plugin installed into an engine whose install-time context is `TContext`.
 * The 3D viewer re-exports `Plugin = Plugin<ViewerContext>`; the PDF engine
 * uses `Plugin<DocumentContext>`.
 */
export interface Plugin<TContext = unknown> {
  /** Unique name. Used as the key in dependency lists. */
  readonly name: string;
  readonly version?: string;
  /** Other plugin names that must be installed before this one. */
  readonly dependencies?: readonly string[];
  install(ctx: TContext): void | Promise<void>;
  uninstall?(): void | Promise<void>;
}

/**
 * Lifecycle events every engine's event map must declare so the
 * `PluginManager` can announce register/unregister. Engine event maps
 * (`ViewerEvents`, `DocumentEvents`) include these keys.
 */
export interface PluginLifecycleEvents {
  'plugin:registered': { name: string };
  'plugin:unregistered': { name: string };
}

interface Entry<TContext> {
  plugin: Plugin<TContext>;
  installed: boolean;
}

/**
 * Plugin lifecycle. Resolves dependencies, calls install/uninstall, and
 * cleans up commands owned by a plugin on uninstall. Generic over the
 * install context and the host event map.
 */
export class PluginManager<TContext, TEvents extends PluginLifecycleEvents>
  implements PluginRegistryView
{
  private entries = new Map<string, Entry<TContext>>();

  constructor(
    private readonly ctx: TContext,
    private readonly commands: CommandRegistry,
    private readonly events: EventBus<TEvents>,
  ) {}

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get<T = unknown>(name: string): T | null {
    return (this.entries.get(name)?.plugin as T) ?? null;
  }

  list(): Plugin<TContext>[] {
    return [...this.entries.values()].map((e) => e.plugin);
  }

  async register(plugin: Plugin<TContext>): Promise<void> {
    if (this.entries.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    for (const dep of plugin.dependencies ?? []) {
      const entry = this.entries.get(dep);
      if (!entry || !entry.installed) {
        throw new Error(
          `Plugin "${plugin.name}" depends on "${dep}", which is not installed`,
        );
      }
    }
    const entry: Entry<TContext> = { plugin, installed: false };
    this.entries.set(plugin.name, entry);
    this.commands.withOwner(plugin.name);
    try {
      await plugin.install(this.ctx);
      entry.installed = true;
      this.events.emit(
        'plugin:registered',
        { name: plugin.name } as TEvents['plugin:registered'],
      );
    } catch (err) {
      this.entries.delete(plugin.name);
      this.commands.unregisterByOwner(plugin.name);
      throw err;
    } finally {
      this.commands.withOwner(null);
    }
  }

  async unregister(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return;
    // Refuse to unregister if other installed plugins depend on this one.
    for (const other of this.entries.values()) {
      if (other === entry || !other.installed) continue;
      if (other.plugin.dependencies?.includes(name)) {
        throw new Error(
          `Cannot unregister "${name}": "${other.plugin.name}" depends on it`,
        );
      }
    }
    try {
      await entry.plugin.uninstall?.();
    } catch (err) {
      console.error(`[viewer] uninstall("${name}") threw:`, err);
    }
    this.commands.unregisterByOwner(name);
    this.entries.delete(name);
    this.events.emit(
      'plugin:unregistered',
      { name } as TEvents['plugin:unregistered'],
    );
  }

  /** Tear everything down in reverse install order. */
  async disposeAll(): Promise<void> {
    const names = [...this.entries.keys()].reverse();
    for (const name of names) {
      await this.unregister(name);
    }
  }
}
