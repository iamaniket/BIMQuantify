import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import type { ViewerContext } from '../../../core/types.js';

import { bcfPlugin, type BcfViewpointData } from './index';

/**
 * Minimal mock context exercising the camera-restore path of
 * `applyViewpoint`. Only `three` is a runtime import of the plugin, so the
 * plugin loads without the rest of the viewer.
 */
function makeCtx(camera?: THREE.PerspectiveCamera | THREE.OrthographicCamera) {
  const cam = camera ?? new THREE.PerspectiveCamera(60, 1.6, 0.1, 1000);
  cam.position.set(5, 5, 5);

  const order: string[] = [];
  const cameraControls = {
    // Volatile current distance — the old code used this; the fix must not.
    distance: 9999,
    getTarget: (v: THREE.Vector3) => v.set(0, 0, 0),
    setFocalOffset: vi.fn(() => {
      order.push('setFocalOffset');
    }),
    setLookAt: vi.fn(async () => {
      order.push('setLookAt');
    }),
    updateCameraUp: vi.fn(),
    zoomTo: vi.fn(async () => {}),
  };

  // Model centred on the origin, extent ±10.
  const model = {
    box: new THREE.Box3(
      new THREE.Vector3(-10, -10, -10),
      new THREE.Vector3(10, 10, 10),
    ),
    object: new THREE.Object3D(),
  };

  const ctx = {
    camera: cam,
    cameraControls,
    models: () => new Map([['m1', model]]),
    commands: { register: vi.fn(), execute: vi.fn(async () => undefined) },
    events: { emit: vi.fn() },
  } as unknown as ViewerContext;

  return { ctx, cam, cameraControls, order };
}

const perspectiveLookingAtOrigin: BcfViewpointData = {
  camera: {
    type: 'perspective',
    // 100 units down +Z, looking back toward the origin.
    viewPoint: { x: 0, y: 0, z: 100 },
    direction: { x: 0, y: 0, z: -1 },
    upVector: { x: 0, y: 1, z: 0 },
    fieldOfView: 60,
  },
};

describe('applyViewpoint camera restore', () => {
  it('places the eye at the stored viewPoint, ignoring the live orbit distance', async () => {
    const { ctx, cameraControls } = makeCtx();
    const plugin = bcfPlugin();
    plugin.install(ctx);

    await plugin.applyViewpoint(perspectiveLookingAtOrigin);

    // eye === stored viewPoint; target reconstructed at the model's depth
    // along the ray (eye + dir * 100 = origin), NOT eye + dir * 9999.
    expect(cameraControls.setLookAt).toHaveBeenCalledTimes(1);
    expect(cameraControls.setLookAt).toHaveBeenCalledWith(
      0,
      0,
      100,
      expect.closeTo(0),
      expect.closeTo(0),
      expect.closeTo(0),
      true,
    );
  });

  it('clears the accumulated focal offset before moving the camera', async () => {
    const { ctx, cameraControls, order } = makeCtx();
    const plugin = bcfPlugin();
    plugin.install(ctx);

    await plugin.applyViewpoint(perspectiveLookingAtOrigin);

    expect(cameraControls.setFocalOffset).toHaveBeenCalledWith(0, 0, 0, true);
    expect(order.indexOf('setFocalOffset')).toBeLessThan(
      order.indexOf('setLookAt'),
    );
  });

  it('applies the stored up vector', async () => {
    const { ctx, cam } = makeCtx();
    const plugin = bcfPlugin();
    plugin.install(ctx);

    await plugin.applyViewpoint({
      camera: {
        ...perspectiveLookingAtOrigin.camera,
        upVector: { x: 0, y: 0, z: 1 },
      },
    });

    expect(cam.up.x).toBeCloseTo(0);
    expect(cam.up.y).toBeCloseTo(0);
    expect(cam.up.z).toBeCloseTo(1);
  });

  it('restores orthographic zoom from the captured visible height', async () => {
    // Frustum height 40, captured visible height 20 -> zoom 2.
    const ortho = new THREE.OrthographicCamera(-32, 32, 20, -20, 0.1, 1000);
    const { ctx, cameraControls } = makeCtx(ortho);
    const plugin = bcfPlugin();
    plugin.install(ctx);

    await plugin.applyViewpoint({
      camera: {
        type: 'orthographic',
        viewPoint: { x: 0, y: 0, z: 100 },
        direction: { x: 0, y: 0, z: -1 },
        upVector: { x: 0, y: 1, z: 0 },
        fieldOfHeight: 20,
      },
    });

    expect(cameraControls.zoomTo).toHaveBeenCalledWith(2, true);
  });
});
