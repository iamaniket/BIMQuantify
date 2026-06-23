import { describe, expect, it } from 'vitest';

import {
  setOrbitPointNoClamp,
  type OrbitClampControls,
} from './setOrbitPointNoClamp';

/**
 * Fake controls that records the clamp band at the moment setOrbitPoint runs,
 * mirroring the FakeControls pattern in camera-fly/index.test.ts. Asserting on
 * the band *at call time* is the whole point: that's when dollyTo's clamp would
 * otherwise fire and snap the camera.
 */
class FakeControls implements OrbitClampControls {
  minDistance = 1;
  maxDistance = 300;
  /** [minDistance, maxDistance] captured inside setOrbitPoint. */
  bandAtCall: [number, number] | null = null;
  calls: Array<[number, number, number]> = [];

  setOrbitPoint(x: number, y: number, z: number): void {
    this.bandAtCall = [this.minDistance, this.maxDistance];
    this.calls.push([x, y, z]);
  }
}

describe('setOrbitPointNoClamp', () => {
  it('relaxes the clamp band to [EPSILON, Infinity] while setOrbitPoint runs', () => {
    const controls = new FakeControls();
    setOrbitPointNoClamp(controls, 1, 2, 3);
    expect(controls.bandAtCall).toEqual([Number.EPSILON, Infinity]);
    expect(controls.calls).toEqual([[1, 2, 3]]);
  });

  it('restores the original min/max distance afterward', () => {
    const controls = new FakeControls();
    controls.minDistance = 4.2;
    controls.maxDistance = 5000;
    setOrbitPointNoClamp(controls, 0, 0, 0);
    expect(controls.minDistance).toBe(4.2);
    expect(controls.maxDistance).toBe(5000);
  });

  it('restores the band even if setOrbitPoint throws', () => {
    const controls: OrbitClampControls = {
      minDistance: 7,
      maxDistance: 70,
      setOrbitPoint() {
        throw new Error('boom');
      },
    };
    expect(() => setOrbitPointNoClamp(controls, 0, 0, 0)).toThrow('boom');
    expect(controls.minDistance).toBe(7);
    expect(controls.maxDistance).toBe(70);
  });
});
