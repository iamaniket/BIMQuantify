/**
 * Constant screen-space size for the section-plane helper quad.
 *
 * The OBC `SimplePlane` helper is a **unit** plane (`PlaneGeometry(1)`) whose
 * world side length equals `_planeMesh.scale`. To make it read as a fixed-size
 * on-screen handle (xeokit's section control behaviour) rather than a
 * model-spanning sheet, we size that world quad so it covers a fixed `fraction`
 * of the **viewport height** at the plane's current depth — independent of zoom.
 *
 * OBC ships its own `autoScale`, but it only handles `PerspectiveCamera` and
 * bakes in a fixed `/7` factor that ignores the field of view. This viewer's
 * `OrthoPerspectiveCamera` switches between both projections, so we compute the
 * size ourselves, fov-accurate, for each:
 *
 *  - **Perspective**: the world height spanned by the viewport at distance `d`
 *    is `2 · d · tan(fov/2)`. The straight-line camera→point distance cancels
 *    against perspective foreshortening, so the projected size is constant.
 *  - **Orthographic**: the viewport spans `(top − bottom) / zoom` world units
 *    regardless of distance; only the zoom matters.
 *
 * Returns `null` for anything that is not one of the two camera types (e.g. the
 * stub `ctx.camera` used in unit tests), so callers can skip sizing.
 */

import * as THREE from 'three';

const _camPos = new THREE.Vector3();

/**
 * World-space side length for the unit helper quad so it occupies `fraction` of
 * the viewport height when it faces the camera (smaller when edge-on — hence
 * "maximum" `fraction`). `point` is the plane's world-space origin.
 */
export function computePlaneScreenSize(
  camera: unknown,
  point: THREE.Vector3,
  fraction: number,
): number | null {
  if (camera instanceof THREE.PerspectiveCamera) {
    const distance = camera.getWorldPosition(_camPos).distanceTo(point);
    const viewportWorldHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    return fraction * viewportWorldHeight;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    const zoom = camera.zoom || 1;
    const viewportWorldHeight = (camera.top - camera.bottom) / zoom;
    return fraction * viewportWorldHeight;
  }
  return null;
}
