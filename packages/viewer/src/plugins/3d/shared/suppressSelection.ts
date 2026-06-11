/**
 * Shared selection/hover suppression for camera tools.
 *
 * Several pointer/camera tools (navigate, fly) want the camera to drive freely
 * while click-selection and hover-highlight stay out of the way. This captures
 * every mouse gesture currently wired to `selection.pick*` / `hover.pick` /
 * `hover.clear`, unbinds them, clears any lingering hover paint, and returns a
 * restore function that rebinds exactly what was removed. The selection plugin's
 * state and its painted highlights are never touched, so an existing selection
 * stays visible while the tool is active.
 */

import type { ViewerContext } from '../../../core/types.js';

const isSuppressed = (command: string): boolean =>
  command.startsWith('selection.pick') ||
  command === 'hover.pick' ||
  command === 'hover.clear';

/**
 * Unbind selection/hover gestures and return a disposer that rebinds them.
 * The disposer is idempotent-safe to await once; calling it rebinds the saved
 * set. Safe to call even if the mouse-bindings plugin is unavailable (no-op).
 */
export async function suppressSelectionGestures(
  ctx: ViewerContext,
): Promise<() => Promise<void>> {
  const bindings =
    (await ctx.commands.execute<undefined, Array<{ gesture: string; command: string }>>(
      'mouseBindings.list',
    )) ?? [];
  const saved = bindings.filter((b) => isSuppressed(b.command));

  for (const b of saved) {
    await ctx.commands.execute('mouseBindings.unbind', { gesture: b.gesture });
  }

  // Drop any lingering hover paint so nothing stays highlighted.
  await ctx.commands.execute('hover.clear').catch(() => undefined);

  return async (): Promise<void> => {
    for (const b of saved) {
      await ctx.commands.execute('mouseBindings.bind', {
        gesture: b.gesture,
        command: b.command,
      });
    }
  };
}
