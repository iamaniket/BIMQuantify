/**
 * Pure framing classifier — decides whether the scene's world bounding sphere
 * is currently visible to a camera. Extracted from the `framing-watch` plugin
 * so it can be unit-tested without a WebGL context (construct a THREE camera +
 * Sphere directly).
 *
 * Works for BOTH perspective and orthographic cameras: the frustum is taken
 * straight from the live projection matrix, and the "behind" / "tiny" tests use
 * view-space depth + projection params rather than any perspective-only math.
 *
 * The caller MUST have an up-to-date `camera.matrixWorldInverse` +
 * `camera.projectionMatrix` (call `camera.updateMatrixWorld(true)` first).
 */

import * as THREE from 'three';

export type FramingReason = 'in-view' | 'behind' | 'outside' | 'tiny' | 'empty';

export interface FramingState {
  /** True when the model is framed (in-view or merely tiny); false when lost. */
  inView: boolean;
  reason: FramingReason;
  /** Apparent model size as a fraction (0..1) of the smaller half-frustum. */
  coverage: number;
}

/**
 * Below this fraction of the half-frustum the model reads as a speck — flagged
 * `'tiny'` (still `inView`, a soft "zoom to fit" hint) rather than a hard loss.
 */
export const TINY_COVERAGE = 0.012;

const _center = new THREE.Vector3();
const _vp = new THREE.Matrix4();
const _frustum = new THREE.Frustum();

export function classifyFraming(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  sphere: THREE.Sphere,
): FramingState {
  if (!(sphere.radius > 0) || !Number.isFinite(sphere.radius)) {
    return { inView: false, reason: 'empty', coverage: 0 };
  }

  // View-space center (camera looks down its local -Z).
  _center.copy(sphere.center).applyMatrix4(camera.matrixWorldInverse);
  const dist = -_center.z; // forward distance from the camera to the center

  // Entirely behind the camera — even the near edge of the sphere is behind.
  if (dist + sphere.radius <= 0) {
    return { inView: false, reason: 'behind', coverage: 0 };
  }

  // Lateral / vertical / depth containment from the full projection matrix
  // (correct for both perspective and orthographic).
  _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _frustum.setFromProjectionMatrix(_vp);
  const inFrustum = _frustum.intersectsSphere(sphere);

  // Apparent size vs the smaller half-frustum dimension.
  let coverage: number;
  if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
    const persp = camera as THREE.PerspectiveCamera;
    const halfFovV = THREE.MathUtils.degToRad(persp.fov) / 2;
    const d = Math.max(dist, 1e-6);
    const ratio = THREE.MathUtils.clamp(sphere.radius / d, 0, 1);
    coverage = halfFovV > 1e-9 ? Math.asin(ratio) / halfFovV : 0;
  } else {
    const ortho = camera as THREE.OrthographicCamera;
    const halfHeight = (ortho.top - ortho.bottom) / 2 / (ortho.zoom || 1);
    coverage = halfHeight > 1e-9 ? sphere.radius / halfHeight : 0;
  }

  if (!inFrustum) {
    return { inView: false, reason: 'outside', coverage };
  }
  if (coverage < TINY_COVERAGE) {
    return { inView: true, reason: 'tiny', coverage };
  }
  return { inView: true, reason: 'in-view', coverage };
}
