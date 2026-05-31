/**
 * Camera framing helper shared by the core viewer (initial mount) and the
 * camera plugin (home / named views / zoom-extents). Kept in core so neither
 * side has to duplicate the fit math and core never depends on a plugin.
 */

import * as THREE from 'three';

import type { CameraControls } from './types.js';

const ISO_DIR = new THREE.Vector3(1, 1, 1);

/**
 * Fraction of the available vertical headroom to spend lifting the model
 * above the frame midpoint at the ISO view. The downward iso tilt otherwise
 * leaves a centered model looking low. Expressed as a fraction of headroom
 * (not model size) so it can never push the model out of frame. Increase to
 * raise the model more (max 1 = right up to the top margin).
 */
const ISO_RAISE_RATIO = 0.6;

/**
 * `clamp(dir.y, 0, 1) * hypot(dir.x, dir.z)` evaluated at the iso direction
 * `[1,1,1]` normalised (dir.y ≈ 0.5774, horizontal ≈ 0.8165). Used to
 * normalise the raise factor so iso maps to the full ISO_RAISE_RATIO.
 */
const ISO_OBLIQUENESS = Math.SQRT2 / 3;

/**
 * Orient the camera along `dir` and dolly so the model's bounding SPHERE
 * fits the view. Because the sphere is rotation-invariant, the model frames
 * to the SAME on-screen size from every direction — iso, the six face views,
 * and every ViewCube edge/corner all match, so clicking around the ViewCube
 * never makes the model jump in size.
 *
 * The look-at target is nudged downward for downward-oblique views (full at
 * iso, zero for the face views, horizontal views, and upward views) so the
 * iso tilt doesn't leave the model sitting low. The nudge is clamped to the
 * available headroom, so it never changes the fit or clips the model.
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
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, 1e-3);

  // View direction (camera looks FROM center + d). Fall back to iso.
  const d = (dir && dir.lengthSq() > 0 ? dir.clone() : ISO_DIR.clone()).normalize();

  // Orthographic projection has no FOV — fit the bounding sphere via the
  // controls' built-in helper (centered, no raise).
  if (!(camera instanceof THREE.PerspectiveCamera)) {
    const azimuth = Math.atan2(d.x, d.z);
    const polar = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    void controls.rotateTo(azimuth, polar, animate);
    const fit = box.getBoundingSphere(new THREE.Sphere());
    fit.radius = radius * padding;
    await controls.fitToSphere(fit, animate);
    return;
  }

  // Camera basis. forward points from the camera toward the target.
  const forward = d.clone().negate();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp);
  // Looking straight up/down — pick an arbitrary horizontal right axis.
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  // Distance that fits the bounding sphere within the (smaller) frustum half
  // angle. Direction-independent → identical apparent size from every view.
  const halfV = THREE.MathUtils.degToRad(camera.fov) / 2;
  const halfH = Math.atan(Math.tan(halfV) * camera.aspect);
  const distV = radius / Math.sin(halfV);
  const distH = radius / Math.sin(halfH);
  const distance = Math.max(distV, distH) * padding;

  // Vertical headroom (world units at the target plane) between the sphere
  // edge and the top/bottom of the frame. The padding produces this slack.
  const headroom = Math.max(0, distance * Math.tan(halfV) - radius);

  // Lift the model toward the top margin for downward-oblique views only:
  // full at iso, zero for face/horizontal/upward views (which stay centered).
  const rawObliqueness = THREE.MathUtils.clamp(d.y, 0, 1) * Math.hypot(d.x, d.z);
  const raiseFactor = Math.min(rawObliqueness / ISO_OBLIQUENESS, 1);
  const raise = headroom * ISO_RAISE_RATIO * raiseFactor;

  // Drop the look target along screen-up so the model rises in the frame.
  const target = center.clone().addScaledVector(up, -raise);

  // Reset residual focalOffset accumulated by setOrbitPoint (pivot-rotate
  // orbit drags) and truck (panning). setLookAt does not clear it, so the
  // camera would land at desiredPosition + staleOffset.
  void controls.setFocalOffset(0, 0, 0, animate);

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
