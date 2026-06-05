/**
 * Engine-agnostic handle shapes shared by the 3D `ViewerHandle` and the 2D
 * `DocumentViewerHandle`. These exist so a single host-side component (e.g. the
 * shared measurement panel) can drive *either* viewer through the same
 * command/event vocabulary without importing a concrete handle type.
 *
 * Both `ViewerHandle` and `DocumentViewerHandle` satisfy these structurally —
 * there is intentionally no `extends`, to avoid coupling the two engines' event
 * maps to each other.
 */

/** The command-dispatch surface every viewer handle exposes. */
export interface CommandSurface {
  execute<R = unknown>(name: string, args?: unknown): Promise<R>;
  has(name: string): boolean;
  list(): { name: string; meta: unknown }[];
}

/**
 * The minimal handle a measurement panel needs: fire `measure.*` commands and
 * subscribe to change/exit events. `events.on` is declared as a **method**
 * (bivariant params) with a payload-less handler so both engines' concretely
 * typed `EventBus.on` are assignable to it — the panel re-pulls state via
 * `commands.execute('measure.list')` rather than reading event payloads.
 */
export interface MeasurementController {
  commands: Pick<CommandSurface, 'execute'>;
  events: { on(event: string, handler: () => void): () => void };
}
