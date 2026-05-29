/**
 * Camera framing helper shared by the core viewer (initial mount) and the
 * camera plugin (home / named views / zoom-extents). Kept in core so neither
 * side has to duplicate the fit math and core never depends on a plugin.
 */

import * as THREE from 'three';

import type { CameraControls } from './types.js';

const ISO_DIR = new THREE.Vector3(1, 1, 1);

/**
 * Fraction of the model height to drop the look-at target below the box
 * center. Lifts the model slightly above the frame midpoint so the downward
 * iso view doesn't leave it sitting low. Increase to raise the model more.
 */
const VERTICAL_BIAS = 0.30;

/**
 * Orient the camera along `dir` and dolly so the box fills the view, sizing
 * from BOTH the box's projected width and height against the camera's FOV
 * and aspect ratio. The box is projected onto the camera's screen-right and
 * screen-up axes, so a wide-flat footprint and a tall-slender tower frame to
 * the same on-screen size regardless of viewport shape — unlike a flat
 * `maxDim * padding` distance, which reads only one axis and ignores aspect.
 *
 * The look-at target is dropped slightly below the box center (VERTICAL_BIAS)
 * so the downward iso angle doesn't leave the model sitting low in the frame.
 */
export async function frameView(
  controls: CameraControls,
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  box: THREE.Box3,
  dir: THREE.Vector3 | null,
  padding: number,
  animate: boolean,
): Promise<void> {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  // View direction (camera looks FROM center + d). Fall back to iso.
  const d = (dir && dir.lengthSq() > 0 ? dir.clone() : ISO_DIR.clone()).normalize();

  // Orthographic projection has no FOV — fit the bounding sphere instead.
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    const azimuth = Math.atan2(d.x, d.z);
    const polar = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    void controls.rotateTo(azimuth, polar, animate);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    sphere.radius = Math.max(sphere.radius, 1e-3) * padding;
    await controls.fitToSphere(sphere, animate);
    return;
  }

  // Camera basis. forward points from the camera toward the target.
  const forward = d.clone().negate();
  const worldUp = new THREE.Vector3(0, 1, 0);
  let right = new THREE.Vector3().crossVectors(forward, worldUp);
  // Looking straight up/down — pick an arbitrary horizontal right axis.
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  // Aim a little below the box center so the model sits slightly above the
  // frame midpoint — the downward iso angle otherwise leaves it looking low.
  // Looking below center pushes the model up in the frame.
  const target = new THREE.Vector3(center.x, center.y - size.y * VERTICAL_BIAS, center.z);
  // Box center relative to the (lowered) target — folded into the corner
  // projection so the fit is measured from the target and nothing clips.
  const offset = center.clone().sub(target);

  // Project the 8 box corners (relative to the target) onto right/up to get
  // the on-screen half-extents.
  const hx = size.x / 2;
  const hy = size.y / 2;
  const hz = size.z / 2;
  let halfW = 0;
  let halfH = 0;
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sy = -1; sy <= 1; sy += 2) {
      for (let sz = -1; sz <= 1; sz += 2) {
        const corner = new THREE.Vector3(sx * hx, sy * hy, sz * hz).add(offset);
        halfW = Math.max(halfW, Math.abs(corner.dot(right)));
        halfH = Math.max(halfH, Math.abs(corner.dot(up)));
      }
    }
  }

  // Distance needed so the projected box fits both axes of the frustum.
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const tanV = Math.tan(fovV / 2);
  const tanH = tanV * camera.aspect;
  const distForHeight = halfH / tanV;
  const distForWidth = halfW / tanH;
  const distance = Math.max(distForHeight, distForWidth, 1e-3) * padding;

  await controls.setLookAt(
    target.x + d.x * distance,
    target.y + d.y * distance,
    target.z + d.z * distance,
    target.x,
    target.y,
    target.z,
    animate,
  );
}
