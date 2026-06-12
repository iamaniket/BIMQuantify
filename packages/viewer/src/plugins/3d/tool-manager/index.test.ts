import { describe, expect, it } from 'vitest';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { eraserPlugin } from '../eraser/index';
import { navigatePlugin } from '../navigate/index';
import { toolManagerPlugin } from './index';

/** Flush pending microtasks + the macrotask queue (tool-manager's install
 *  fires `void applyAction(...)`, and sub-commands resolve on later ticks). */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

type ToolState = { navMode: string; action: string };

// ----------------------------------------------------------------------------
// Block A — orchestration against recording stubs for the sub-plugin commands.
// Asserts the exact sub-command sequence tool-manager drives per transition.
// ----------------------------------------------------------------------------

const SUB_COMMANDS = [
  'eraser.enter',
  'eraser.exit',
  'navigate.enter',
  'navigate.exit',
  'cameraFly.enable',
  'cameraFly.disable',
] as const;

async function makeOrchestrationHarness(): Promise<{
  commands: CommandRegistry;
  events: EventBus<ViewerEvents>;
  calls: string[];
  get: () => Promise<ToolState>;
}> {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const calls: string[] = [];
  // Pure recorders — they do NOT emit change events, so the orchestration
  // assertions aren't entangled with the reconcile safety-net (tested apart).
  for (const name of SUB_COMMANDS) {
    commands.register(name, () => {
      calls.push(name);
    });
  }
  const ctx = { commands, events } as unknown as ViewerContext;
  toolManagerPlugin().install(ctx);
  await tick(); // let the bootstrap applyAction('none') settle
  calls.length = 0; // ignore bootstrap calls
  const get = (): Promise<ToolState> => commands.execute<undefined, ToolState>('tool.get');
  return { commands, events, calls, get };
}

describe('tool-manager orchestration', () => {
  it('select then erase drive the right sub-plugins and update the action', async () => {
    const { commands, events, calls, get } = await makeOrchestrationHarness();
    const actions: string[] = [];
    events.on('action:change', ({ action }) => actions.push(action));

    await commands.execute('tool.select'); // none → select (settle to baseline)
    expect(calls).toEqual(['eraser.exit', 'navigate.exit']);
    expect((await get()).action).toBe('select');

    calls.length = 0;
    await commands.execute('tool.erase'); // select → erase
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'eraser.enter']);
    expect((await get()).action).toBe('erase');

    calls.length = 0;
    await commands.execute('tool.erase'); // erase → none (toggle off)
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'navigate.enter']);
    expect((await get()).action).toBe('none');

    expect(actions).toEqual(['select', 'erase', 'none']);
  });

  it('first-person forces action to none and restores the saved action on return to orbit', async () => {
    const { commands, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.erase'); // action = erase
    calls.length = 0;

    await commands.execute('tool.firstPerson'); // orbit → first-person
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'cameraFly.enable']);
    expect(await get()).toEqual({ navMode: 'firstPerson', action: 'none' });

    calls.length = 0;
    await commands.execute('tool.firstPerson'); // first-person → orbit (toggle)
    expect(calls).toEqual(['cameraFly.disable', 'eraser.exit', 'navigate.exit', 'eraser.enter']);
    expect(await get()).toEqual({ navMode: 'orbit', action: 'erase' });
  });

  it('pushOverride neutralizes the action axis and popOverride restores it (orbit + erase)', async () => {
    const { commands, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.erase'); // action = erase
    calls.length = 0;

    await commands.execute('tool.pushOverride'); // edit tool enters
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'navigate.enter']);
    expect((await get()).action).toBe('erase'); // stored action untouched

    calls.length = 0;
    await commands.execute('tool.popOverride'); // edit tool exits
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'eraser.enter']);
    expect((await get()).action).toBe('erase'); // erase restored
  });

  it('pushOverride from the select baseline pops back to the select baseline', async () => {
    const { commands, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.select'); // action = select
    calls.length = 0;

    await commands.execute('tool.pushOverride');
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'navigate.enter']); // suppress

    calls.length = 0;
    await commands.execute('tool.popOverride');
    expect(calls).toEqual(['eraser.exit', 'navigate.exit']); // back to baseline, no enter
    expect((await get()).action).toBe('select');
  });

  it('is modal while an override is held: nav/action toggles are inert and emit nothing', async () => {
    const { commands, events, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.select'); // action = select
    await commands.execute('tool.pushOverride');
    calls.length = 0;

    const emitted: string[] = [];
    events.on('action:change', () => emitted.push('action'));
    events.on('navmode:change', () => emitted.push('navmode'));

    await commands.execute('tool.erase'); // inert
    await commands.execute('tool.firstPerson'); // inert
    await commands.execute('tool.set', { navMode: 'firstPerson', action: 'erase' }); // inert

    expect(calls).toEqual([]);
    expect(emitted).toEqual([]);
    expect(await get()).toEqual({ navMode: 'orbit', action: 'select' });

    await commands.execute('tool.popOverride');
    expect((await get()).action).toBe('select');
  });

  it('treats pushOverride / popOverride as no-ops in first-person', async () => {
    const { commands, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.firstPerson'); // first-person (camera-fly owns left)
    calls.length = 0;

    await commands.execute('tool.pushOverride');
    await commands.execute('tool.popOverride');

    expect(calls).toEqual([]); // action sub-plugins already neutral
    expect((await get()).navMode).toBe('firstPerson');
  });

  it('serializes a pop-then-push eviction so the override stays neutralized', async () => {
    const { commands, calls, get } = await makeOrchestrationHarness();
    await commands.execute('tool.erase'); // action = erase
    await commands.execute('tool.pushOverride'); // tool A active (neutralized)
    calls.length = 0;

    // Eviction: exit A's pop immediately followed by enter B's push, unawaited
    // between — exactly the `mode.enter` "evict current tool" path.
    const popping = commands.execute('tool.popOverride');
    const pushing = commands.execute('tool.pushOverride');
    await Promise.all([popping, pushing]);

    // The chain ran pop's restore THEN push's re-neutralize — navigate.enter is
    // last, so a left-click is suppressed (not erasing) while tool B owns it.
    expect(calls).toEqual([
      'eraser.exit', 'navigate.exit', 'eraser.enter', // pop → applyAction('erase')
      'eraser.exit', 'navigate.exit', 'navigate.enter', // push → applyAction('none')
    ]);

    // And a subsequent exit still restores erase exactly.
    calls.length = 0;
    await commands.execute('tool.popOverride');
    expect(calls).toEqual(['eraser.exit', 'navigate.exit', 'eraser.enter']);
    expect((await get()).action).toBe('erase');
  });

  it('reconcile maps a direct sub-tool drive onto the action field (safety net)', async () => {
    const { events, calls, get } = await makeOrchestrationHarness();

    events.emit('eraser:change', { active: true }); // eraser driven directly
    expect((await get()).action).toBe('erase');

    calls.length = 0;
    events.emit('eraser:change', { active: false }); // and back off → select baseline
    expect((await get()).action).toBe('select');
  });

  it('reconcile is inert while an override is held', async () => {
    const { commands, events, get } = await makeOrchestrationHarness();
    await commands.execute('tool.select');
    await commands.execute('tool.pushOverride');

    events.emit('eraser:change', { active: true }); // ignored under override

    expect((await get()).action).toBe('select');
  });
});

// ----------------------------------------------------------------------------
// Block B — the B1 fix at the binding level, with the REAL eraser + navigate
// plugins over a Map-backed fake mouse-bindings. Proves that entering an edit
// override while erasing clears the live `click:left → eraser.pickHide` bind.
// ----------------------------------------------------------------------------

async function makeBindingHarness(): Promise<{
  commands: CommandRegistry;
  bindings: Map<string, string>;
}> {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  const bindings = new Map<string, string>([
    ['click:left', 'selection.pickSet'],
    ['move', 'hover.pick'],
    ['move:leave', 'hover.clear'],
    ['doubleclick:left', 'visibility.isolateAtPointer'],
  ]);
  commands.register('mouseBindings.list', () =>
    [...bindings].map(([gesture, command]) => ({ gesture, command })),
  );
  commands.register('mouseBindings.bind', (args: unknown) => {
    const a = args as { gesture: string; command: string };
    bindings.set(a.gesture, a.command);
  });
  commands.register('mouseBindings.unbind', (args: unknown) => {
    const a = args as { gesture: string };
    bindings.delete(a.gesture);
  });
  commands.register('hover.clear', () => {});
  commands.register('selection.clear', () => {});

  const ctx = { commands, events } as unknown as ViewerContext;
  eraserPlugin().install(ctx);
  navigatePlugin().install(ctx);
  toolManagerPlugin().install(ctx);
  await tick();
  return { commands, bindings };
}

describe('tool-manager × eraser binding (B1 latent-bug fix)', () => {
  it('clears the eraser click bind on override push and restores it on pop', async () => {
    const { commands, bindings } = await makeBindingHarness();

    await commands.execute('tool.select'); // settle to the selection baseline
    expect(bindings.get('click:left')).toBe('selection.pickSet');

    await commands.execute('tool.erase'); // erase active
    expect(bindings.get('click:left')).toBe('eraser.pickHide');

    await commands.execute('tool.pushOverride'); // enter edit mode while erasing
    expect(bindings.get('click:left')).not.toBe('eraser.pickHide'); // ← the fix

    await commands.execute('tool.popOverride'); // exit edit mode
    expect(bindings.get('click:left')).toBe('eraser.pickHide'); // erase restored
  });
});
