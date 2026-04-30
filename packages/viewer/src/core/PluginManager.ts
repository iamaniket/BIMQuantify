/**
 * Plugin lifecycle. Resolves dependencies, calls install/uninstall, and
 * cleans up commands owned by a plugin on uninstall.
 */

import type { CommandRegistry } from './CommandRegistry.js';
import type { EventBus } from './EventBus.js';
import type { Plugin, PluginRegistryView, ViewerContext, ViewerEvents } from './types.js';

interface Entry {
  plugin: Plugin;
  installed: boolean;
}

export class PluginManager implements PluginRegistryView {
  private entries = new Map<string, Entry>();

  constructor(
    private readonly ctx: ViewerContext,
    private readonly commands: CommandRegistry,
    private readonly events: EventBus<ViewerEvents>,
  ) {}

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get<T = Plugin>(name: string): T | null {
    return (this.entries.get(name)?.plugin as T) ?? null;
  }

  list(): Plugin[] {
    return [...this.entries.values()].map((e) => e.plugin);
  }

  async register(plugin: Plugin): Promise<void> {
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
    const entry: Entry = { plugin, installed: false };
    this.entries.set(plugin.name, entry);
    this.commands.withOwner(plugin.name);
    try {
      await plugin.install(this.ctx);
      entry.installed = true;
      this.events.emit('plugin:registered', { name: plugin.name });
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
    this.events.emit('plugin:unregistered', { name });
  }

  /** Tear everything down in reverse install order. */
  async disposeAll(): Promise<void> {
    const names = [...this.entries.keys()].reverse();
    for (const name of names) {
      await this.unregister(name);
    }
  }
}
