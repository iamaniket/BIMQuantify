import { describe, expect, it } from 'vitest';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { modePlugin } from './index';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

describe('mode delegates the click-action axis to the tool-manager override', () => {
  it('pushes on enter, pops on exit, and never toggles selection/hover itself', async () => {
    const commands = new CommandRegistry();
    const events = new EventBus<ViewerEvents>();
    const executed: string[] = [];
    for (const name of [
      'tool.pushOverride',
      'tool.popOverride',
      'selection.setEnabled',
      'selection.isEnabled',
      'hover.setEnabled',
      'hover.isEnabled',
    ]) {
      commands.register(name, () => {
        executed.push(name);
      });
    }
    // `cameraControls: {}` → `({}).constructor.ACTION` is undefined, so the
    // camera-button branch is skipped; `container` only needs querySelector.
    const ctx = {
      commands,
      events,
      cameraControls: {},
      container: { querySelector: () => null },
    } as unknown as ViewerContext;

    modePlugin().install(ctx);

    await commands.execute('mode.enter', {
      name: 'measurement.distance',
      label: 'Measure',
      preserveCamera: true,
      cancel: () => false,
    });
    await tick();
    expect(executed).toContain('tool.pushOverride');

    await commands.execute('mode.exit');
    await tick();
    expect(executed).toContain('tool.popOverride');

    // The single-arbiter goal: mode no longer reaches into selection/hover.
    expect(executed).not.toContain('selection.setEnabled');
    expect(executed).not.toContain('hover.setEnabled');
    expect(executed.indexOf('tool.pushOverride')).toBeLessThan(
      executed.indexOf('tool.popOverride'),
    );
  });
});
