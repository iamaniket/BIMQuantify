// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { keyboardShortcutsPlugin } from './index';

// Unit under test: the WINDOW-level fallback listener (`onWindowKey`). It must
// dispatch a shortcut only when THIS viewer is the "active" one. By default that
// means the viewer's own container is hovered/focused (so two viewers on a page
// don't double-fire). A host can opt a common ancestor in via
// `data-viewer-shortcut-scope`, so hover/focus anywhere inside it counts as
// active — this is what keeps the 3D nav shortcuts alive while the cursor is
// over the sibling floor-plan pane in the split view.
//
// happy-dom has no pointer, so `matches(':hover')` is always false here; these
// tests therefore drive the FOCUS side of the guard (`document.activeElement`),
// which is exactly the branch the fix broadened from `=== container` to
// `scope.contains(activeElement)`.

type Harness = { calls: string[]; container: HTMLElement; cleanup: () => void };

function mountPlugin(layout: (container: HTMLElement) => void): Harness {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const calls: string[] = [];
  commands.register('camera.home', () => { calls.push('camera.home'); }, {
    title: 'Home view',
    defaultShortcut: 'H',
  });

  const container = document.createElement('div');
  layout(container); // place container (and any siblings/wrapper) in the DOM
  const ctx = { commands, events, container } as unknown as ViewerContext;
  const plugin = keyboardShortcutsPlugin();
  plugin.install(ctx);

  return {
    calls,
    container,
    cleanup: () => {
      plugin.uninstall?.(); // removes the window listener so cases don't leak
      document.body.innerHTML = '';
    },
  };
}

// Dispatch on <body> (outside the container) so the WINDOW listener is the one
// that handles it: body bubbles up to window, and `container.contains(body)` is
// false so the plugin's "already handled by the container listener" early-out
// doesn't fire.
function pressH(): void {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'H', code: 'KeyH', bubbles: true }),
  );
}

let active: Harness | null = null;
afterEach(() => { active?.cleanup(); active = null; });

describe('keyboard-shortcuts window-fallback scope', () => {
  it('default (no marked ancestor): fires when the container itself holds focus', () => {
    active = mountPlugin((container) => { document.body.appendChild(container); });
    active.container.focus(); // plugin sets tabindex=0, so the div is focusable
    expect(document.activeElement).toBe(active.container);

    pressH();
    expect(active.calls).toEqual(['camera.home']);
  });

  it('default (no marked ancestor): stays silent when focus is outside the container', () => {
    active = mountPlugin((container) => { document.body.appendChild(container); });
    (document.activeElement as HTMLElement | null)?.blur?.();

    pressH();
    expect(active.calls).toEqual([]);
  });

  it('opt-in scope: fires when focus is on a SIBLING inside the marked ancestor (the split-view fix)', () => {
    let sibling!: HTMLButtonElement;
    active = mountPlugin((container) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-viewer-shortcut-scope', '');
      sibling = document.createElement('button'); // stands in for the plan pane
      wrapper.append(container, sibling);
      document.body.appendChild(wrapper);
    });
    sibling.focus();
    expect(active.calls).toEqual([]); // sanity: focusing alone fires nothing

    pressH();
    // Before the fix the guard required the 3D container itself to be hovered/
    // focused, so a sibling-focused keydown produced []. Now it dispatches.
    expect(active.calls).toEqual(['camera.home']);
  });

  it('opt-in scope: stays silent when focus is OUTSIDE the marked ancestor', () => {
    let outside!: HTMLButtonElement;
    active = mountPlugin((container) => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-viewer-shortcut-scope', '');
      wrapper.appendChild(container);
      document.body.appendChild(wrapper);
      outside = document.createElement('button');
      document.body.appendChild(outside); // a peer of the wrapper, not inside it
    });
    outside.focus();

    pressH();
    expect(active.calls).toEqual([]);
  });
});
