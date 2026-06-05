/**
 * Inspect plugin. Bridges "inspect this element" intents (keyboard shortcut
 * or context menu) to the host app via the `inspect:request` event. The
 * viewer has no inspector UI of its own — the portal listens and opens its
 * side panel on the requested tab.
 *
 * Each command resolves the target item from the current selection (so a
 * keyboard press acts on what's selected) and emits the event. The context
 * menu selects the clicked element first, so both paths converge on the
 * selection.
 *
 * Depends on the `selection` plugin for reading the current selection set.
 */

import type { ItemId, Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'inspect' as const;

type InspectView = 'properties' | 'attachments' | 'findings' | 'certificates';

export function inspectPlugin(): Plugin {
  let ctxRef: ViewerContext | null = null;

  const firstSelected = async (): Promise<ItemId | null> => {
    if (!ctxRef) return null;
    try {
      const sel = (await ctxRef.commands.execute<undefined, ItemId[]>('selection.get')) ?? [];
      return sel[0] ?? null;
    } catch {
      return null;
    }
  };

  const request = async (view: InspectView): Promise<void> => {
    if (!ctxRef) return;
    const item = await firstSelected();
    ctxRef.events.emit('inspect:request', { item, view });
  };

  return {
    name: NAME,
    dependencies: ['selection'],

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('inspect.properties', () => request('properties'), {
        title: 'Inspect properties',
        defaultShortcut: 'P',
      });
      ctx.commands.register('inspect.attach', () => request('attachments'), {
        title: 'Attach to element',
        defaultShortcut: 'A',
      });
      ctx.commands.register('inspect.findings', () => request('findings'), {
        title: 'Add findings',
        defaultShortcut: 'B',
      });
      ctx.commands.register('inspect.certificates', () => request('certificates'), {
        title: 'View certificates',
        defaultShortcut: 'C',
      });
    },

    uninstall() {
      ctxRef = null;
    },
  };
}
