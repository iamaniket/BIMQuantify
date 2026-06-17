import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommandRegistry } from '../../../core/CommandRegistry';
import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { cameraFlyPlugin } from './index';

/**
 * Regression coverage for the pose-preserving Orbit↔FirstPerson switch.
 *
 * ThatOpen's `OrbitMode`/`FirstPersonMode` relocate the orbit pivot (by distance
 * from world origin) and nudge the eye on every mode swap. camera-fly snapshots
 * the pre-fly pose and re-asserts it via `setLookAt` after each swap so the view
 * never drifts. Crucially the exit re-assert must run AFTER min/maxDistance are
 * restored, or camera-controls would clamp the orbit radius to ThatOpen's
 * [1, 300] and corrupt large-model views.
 *
 * Runs in the default node environment (no jsdom): camera-fly's enable() touches
 * window / requestAnimationFrame / container listeners, so those are stubbed.
 */

interface RecordedLookAt {
  px: number; py: number; pz: number;
  tx: number; ty: number; tz: number;
  transition: boolean;
  /** min/maxDistance at the moment of the call — proves restore-then-reassert order. */
  minAtCall: number;
  maxAtCall: number;
}

/** Minimal camera-controls double. `constructor.ACTION` mirrors camera-controls'
 *  static ACTION enum so enable()'s left-button takeover runs. */
class FakeControls {
  static ACTION = { NONE: 0, ROTATE: 1, TRUCK: 2, DOLLY: 8 } as const;

  minDistance = Number.EPSILON;
  maxDistance = Infinity;
  truckSpeed = 2;
  infinityDolly = false;
  dollyToCursor = true;
  distance = Math.sqrt(200);
  mouseButtons = { left: 1, right: 2, middle: 4, wheel: 8 };

  readonly _pos: THREE.Vector3;
  readonly _target: THREE.Vector3;
  readonly setLookAtCalls: RecordedLookAt[] = [];
  readonly focalOffsetCalls: { x: number; y: number; z: number; transition: boolean }[] = [];

  constructor(pos: THREE.Vector3, target: THREE.Vector3) {
    this._pos = pos.clone();
    this._target = target.clone();
  }

  getPosition(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this._pos);
  }
  getTarget(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this._target);
  }
  setLookAt(
    px: number, py: number, pz: number,
    tx: number, ty: number, tz: number,
    transition: boolean,
  ): Promise<void> {
    this.setLookAtCalls.push({
      px, py, pz, tx, ty, tz, transition,
      minAtCall: this.minDistance,
      maxAtCall: this.maxDistance,
    });
    this._pos.set(px, py, pz);
    this._target.set(tx, ty, tz);
    return Promise.resolve();
  }
  setFocalOffset(x: number, y: number, z: number, transition: boolean): Promise<void> {
    this.focalOffsetCalls.push({ x, y, z, transition });
    return Promise.resolve();
  }
}

/** Stub of ThatOpen's OrthoPerspectiveCamera mode switch — mutates min/max the
 *  way OrbitMode/FirstPersonMode do, so the restore ordering is observable. */
function makeObcCamera(controls: FakeControls): { modes: string[]; set(mode: 'Orbit' | 'FirstPerson'): void } {
  return {
    modes: [],
    set(mode) {
      this.modes.push(mode);
      if (mode === 'FirstPerson') {
        controls.minDistance = 1;
        controls.maxDistance = 1;
      } else {
        controls.minDistance = 1;
        controls.maxDistance = 300;
      }
    },
  };
}

function makeCtx(controls: FakeControls): {
  ctx: ViewerContext;
  commands: CommandRegistry;
  obcCamera: ReturnType<typeof makeObcCamera>;
} {
  const commands = new CommandRegistry();
  const events = new EventBus<ViewerEvents>();
  // Commands enable()/disable() reach for. mouseBindings.list is awaited without
  // a catch, so it must resolve; the rest are .catch-guarded but registered for
  // cleanliness.
  commands.register('mouseBindings.list', () => []);
  commands.register('mouseBindings.bind', () => undefined);
  commands.register('mouseBindings.unbind', () => undefined);
  commands.register('hover.clear', () => undefined);
  commands.register('pivotRotate.disable', () => undefined);
  commands.register('pivotRotate.enable', () => undefined);

  const obcCamera = makeObcCamera(controls);
  const noopTarget = { addEventListener: () => undefined, removeEventListener: () => undefined };
  const ctx = {
    cameraControls: controls,
    obcCamera,
    // enable() reads the rendered eye (logical eye + residual focalOffset) off the
    // three camera; the fake has no offset, so the world position == controls._pos.
    camera: { getWorldPosition: (out: THREE.Vector3) => out.copy(controls._pos) },
    canvas: noopTarget,
    container: noopTarget,
    models: () => new Map(),
    commands,
    events,
  } as unknown as ViewerContext;

  return { ctx, commands, obcCamera };
}

describe('camera-fly pose-preserving switch', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: () => undefined, removeEventListener: () => undefined });
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-asserts the pre-fly pose on exit, after min/maxDistance are restored', async () => {
    const controls = new FakeControls(
      new THREE.Vector3(10, 5, 10),
      new THREE.Vector3(0, 5, 0),
    );
    const { ctx, commands, obcCamera } = makeCtx(controls);
    cameraFlyPlugin().install(ctx);

    await commands.execute('cameraFly.enable');
    await commands.execute('cameraFly.disable');

    // Both swaps happened, in order.
    expect(obcCamera.modes).toEqual(['FirstPerson', 'Orbit']);

    // Two re-asserts: entry (radius 1) and exit (pre-fly radius ≈ √200).
    expect(controls.setLookAtCalls).toHaveLength(2);

    const exit = controls.setLookAtCalls[1]!;
    // Eye is exactly where it was pre-fly...
    expect(exit.px).toBeCloseTo(10);
    expect(exit.py).toBeCloseTo(5);
    expect(exit.pz).toBeCloseTo(10);
    // ...looking the same direction at the original orbit radius → target (0,5,0).
    expect(exit.tx).toBeCloseTo(0);
    expect(exit.ty).toBeCloseTo(5);
    expect(exit.tz).toBeCloseTo(0);
    expect(exit.transition).toBe(false);

    // The exit re-assert ran AFTER min/max were restored — not clamped to [1, 300].
    expect(exit.minAtCall).toBe(Number.EPSILON);
    expect(exit.maxAtCall).toBe(Infinity);

    // Controls fully restored to the pre-fly config.
    expect(controls.minDistance).toBe(Number.EPSILON);
    expect(controls.maxDistance).toBe(Infinity);
    expect(controls.truckSpeed).toBe(2);
    expect(controls.infinityDolly).toBe(false);
    expect(controls.dollyToCursor).toBe(true);
    expect(controls.mouseButtons.left).toBe(1);
  });

  it('skips the re-assert when the pre-fly offset is degenerate (eye ≈ target)', async () => {
    const controls = new FakeControls(
      new THREE.Vector3(3, 3, 3),
      new THREE.Vector3(3, 3, 3),
    );
    const { ctx, commands } = makeCtx(controls);
    cameraFlyPlugin().install(ctx);

    await commands.execute('cameraFly.enable');
    await commands.execute('cameraFly.disable');

    // No valid view direction → no pose re-assert in either direction.
    expect(controls.setLookAtCalls).toHaveLength(0);
    // Controls still restored.
    expect(controls.minDistance).toBe(Number.EPSILON);
    expect(controls.maxDistance).toBe(Infinity);
  });

  it('uses the current FPN position on exit, not the pre-fly pose', async () => {
    const controls = new FakeControls(
      new THREE.Vector3(10, 5, 10),
      new THREE.Vector3(0, 5, 0),
    );
    const { ctx, commands } = makeCtx(controls);
    cameraFlyPlugin().install(ctx);

    await commands.execute('cameraFly.enable');

    // Simulate the user walking to a new position during FPN.
    controls._pos.set(50, 10, 30);
    controls._target.set(50, 10, 29); // looking along -Z, 1 unit ahead

    await commands.execute('cameraFly.disable');

    const preRadius = Math.sqrt(200); // pre-fly orbit radius
    const exitCall = controls.setLookAtCalls[controls.setLookAtCalls.length - 1]!;
    // Eye should be at the CURRENT position, not the pre-fly (10,5,10).
    expect(exitCall.px).toBeCloseTo(50);
    expect(exitCall.py).toBeCloseTo(10);
    expect(exitCall.pz).toBeCloseTo(30);
    // Target = current pos + current dir * pre-fly orbit radius.
    expect(exitCall.tx).toBeCloseTo(50);
    expect(exitCall.ty).toBeCloseTo(10);
    expect(exitCall.tz).toBeCloseTo(30 + -1 * preRadius);
  });

  it('clears the residual focalOffset on enter so look-around stays translation-free', async () => {
    const controls = new FakeControls(
      new THREE.Vector3(10, 5, 10),
      new THREE.Vector3(0, 5, 0),
    );
    const { ctx, commands } = makeCtx(controls);
    cameraFlyPlugin().install(ctx);

    await commands.execute('cameraFly.enable');

    // camera-controls re-applies a non-zero focalOffset (left by pivot-rotate /
    // pan) along the camera's local axes every frame — without this reset,
    // rotating the look in fly mode would swing the eye. enable() must zero it,
    // with no transition.
    expect(controls.focalOffsetCalls).toContainEqual({ x: 0, y: 0, z: 0, transition: false });
  });
});
