/**
 * Named command registry. Plugins expose actions here; the host UI
 * (toolbar, panels) drives the viewer by calling `execute(name, args)`,
 * never by touching the scene directly.
 */

export type CommandHandler<A = unknown, R = unknown> = (args: A) => R | Promise<R>;

export interface CommandMeta {
  title?: string;
  description?: string;
  /** Default keyboard combo (e.g. "Escape", "F", "Shift+F", "Ctrl+1"). */
  defaultShortcut?: string;
  /** Plugin name that owns this command. Set automatically by the registry. */
  owner?: string;
}

interface Entry {
  handler: CommandHandler;
  meta: CommandMeta;
}

export class CommandNotFoundError extends Error {
  constructor(name: string) {
    super(`Command "${name}" is not registered`);
    this.name = 'CommandNotFoundError';
  }
}

export class CommandRegistry {
  private entries = new Map<string, Entry>();
  private currentOwner: string | null = null;

  /**
   * Stamp the next registrations with this owner name. Called by
   * PluginManager around `install(ctx)`.
   */
  withOwner(owner: string | null): void {
    this.currentOwner = owner;
  }

  register<A = unknown, R = unknown>(
    name: string,
    handler: CommandHandler<A, R>,
    meta: CommandMeta = {},
  ): void {
    if (this.entries.has(name)) {
      throw new Error(`Command "${name}" is already registered`);
    }
    const owner = this.currentOwner ?? meta.owner;
    const finalMeta: CommandMeta = { ...meta };
    if (owner !== undefined) finalMeta.owner = owner;
    this.entries.set(name, {
      handler: handler as CommandHandler,
      meta: finalMeta,
    });
  }

  unregister(name: string): void {
    this.entries.delete(name);
  }

  /**
   * Drop every command registered while `owner` was active. Used during
   * plugin uninstall so nothing dangles.
   */
  unregisterByOwner(owner: string): void {
    for (const [name, entry] of this.entries) {
      if (entry.meta.owner === owner) this.entries.delete(name);
    }
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  get(name: string): CommandMeta | null {
    return this.entries.get(name)?.meta ?? null;
  }

  list(): { name: string; meta: CommandMeta }[] {
    return [...this.entries].map(([name, entry]) => ({ name, meta: entry.meta }));
  }

  async execute<A = unknown, R = unknown>(name: string, args?: A): Promise<R> {
    const entry = this.entries.get(name);
    if (!entry) throw new CommandNotFoundError(name);
    return (await entry.handler(args)) as R;
  }
}
