import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { computePlaneScreenSize } from './screenSize';

/**
 * The helper turns "occupy `fraction` of the viewport height" into a world-space
 * side length for the unit helper quad. These tests pin the two projection
 * formulas and — the whole point — that the *projected* size stays constant as
 * the camera zooms (distance for perspective, zoom for ortho).
 */
describe('computePlaneScreenSize', () => {
  it('perspective: fraction × 2 × distance × tan(fov/2)', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 10);
    cam.updateMatrixWorld();
    const point = new THREE.Vector3(0, 0, 0); // 10 units away

    const size = computePlaneScreenSize(cam, point, 0.1);
    const expected = 0.1 * 2 * 10 * Math.tan(THREE.MathUtils.degToRad(60) / 2);
    expect(size).not.toBeNull();
    expect(size!).toBeCloseTo(expected, 6);
  });

  it('perspective: projected size is constant — world size scales linearly with distance', () => {
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    const point = new THREE.Vector3(0, 0, 0);

    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld();
    const near = computePlaneScreenSize(cam, point, 0.1)!;

    cam.position.set(0, 0, 10); // twice as far
    cam.updateMatrixWorld();
    const far = computePlaneScreenSize(cam, point, 0.1)!;

    // world size doubles with distance ⇒ the projected (on-screen) size is unchanged.
    expect(far).toBeCloseTo(near * 2, 6);
  });

  it('orthographic: fraction × (top − bottom) / zoom, independent of distance', () => {
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    cam.zoom = 1;
    cam.position.set(0, 0, 100);
    cam.updateMatrixWorld();

    const size = computePlaneScreenSize(cam, new THREE.Vector3(), 0.1);
    expect(size).not.toBeNull();
    expect(size!).toBeCloseTo(0.1 * 20, 6); // (10 − −10)/1 = 20

    // Distance doesn't matter for ortho — only the frustum/zoom.
    cam.position.set(0, 0, 5);
    cam.updateMatrixWorld();
    expect(computePlaneScreenSize(cam, new THREE.Vector3(), 0.1)!).toBeCloseTo(0.1 * 20, 6);
  });

  it('orthographic: doubling zoom halves the world size (constant on screen)', () => {
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000);
    cam.zoom = 1;
    const wide = computePlaneScreenSize(cam, new THREE.Vector3(), 0.1)!;
    cam.zoom = 2;
    const zoomed = computePlaneScreenSize(cam, new THREE.Vector3(), 0.1)!;
    expect(zoomed).toBeCloseTo(wide / 2, 6);
  });

  it('returns null for anything that is not a perspective/orthographic camera', () => {
    expect(computePlaneScreenSize({}, new THREE.Vector3(), 0.1)).toBeNull();
    expect(computePlaneScreenSize(null, new THREE.Vector3(), 0.1)).toBeNull();
    expect(computePlaneScreenSize(new THREE.Object3D(), new THREE.Vector3(), 0.1)).toBeNull();
  });
});
