import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { classifyFraming } from './classify';

/**
 * Pure framing-classifier tests — no WebGL. We construct THREE cameras + a
 * Sphere directly and assert the {inView, reason} verdict for perspective and
 * orthographic projections across the cases the portal's recovery pill keys on.
 */

function persp(): THREE.PerspectiveCamera {
  // Eye at (0,0,10) looking at the origin → forward is world -Z.
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

function ortho(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
  cam.position.set(0, 0, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

const sphere = (x: number, y: number, z: number, r: number): THREE.Sphere =>
  new THREE.Sphere(new THREE.Vector3(x, y, z), r);

describe('classifyFraming — perspective', () => {
  it('reports in-view when the model fills a reasonable part of the frame', () => {
    const s = classifyFraming(persp(), sphere(0, 0, 0, 1));
    expect(s.inView).toBe(true);
    expect(s.reason).toBe('in-view');
    expect(s.coverage).toBeGreaterThan(0.012);
  });

  it('reports behind when the model sits entirely behind the camera', () => {
    // Camera at z=10 looking toward -Z; a sphere at z=20 is behind it.
    const s = classifyFraming(persp(), sphere(0, 0, 20, 1));
    expect(s.inView).toBe(false);
    expect(s.reason).toBe('behind');
  });

  it('reports outside when the model is off to the side of the frustum', () => {
    const s = classifyFraming(persp(), sphere(100, 0, 0, 1));
    expect(s.inView).toBe(false);
    expect(s.reason).toBe('outside');
  });

  it('reports tiny (still inView) when the model is a far speck', () => {
    const s = classifyFraming(persp(), sphere(0, 0, 0, 0.01));
    expect(s.inView).toBe(true);
    expect(s.reason).toBe('tiny');
    expect(s.coverage).toBeLessThan(0.012);
  });

  it('reports empty for a degenerate sphere (no model bounds)', () => {
    expect(classifyFraming(persp(), sphere(0, 0, 0, 0)).reason).toBe('empty');
    expect(classifyFraming(persp(), sphere(0, 0, 0, -1)).reason).toBe('empty');
  });
});

describe('classifyFraming — orthographic', () => {
  it('reports in-view for a model filling the ortho frustum', () => {
    const s = classifyFraming(ortho(), sphere(0, 0, 0, 1));
    expect(s.inView).toBe(true);
    expect(s.reason).toBe('in-view');
  });

  it('reports outside when the model is beyond the ortho extents', () => {
    const s = classifyFraming(ortho(), sphere(100, 0, 0, 1));
    expect(s.inView).toBe(false);
    expect(s.reason).toBe('outside');
  });

  it('reports tiny for a far speck in ortho', () => {
    const s = classifyFraming(ortho(), sphere(0, 0, 0, 0.02));
    expect(s.inView).toBe(true);
    expect(s.reason).toBe('tiny');
  });
});
