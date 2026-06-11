/**
 * Clipping helpers for fat-line materials.
 *
 * The section plugin injects its `THREE.Plane`s into mesh materials by
 * traversing each model object. Fat lines (outline + edge overlays) live on
 * the scene root, so they miss that traversal and would otherwise draw over
 * geometry the section plane has cut away. These helpers let the line-drawing
 * code keep its `LineMaterial.clippingPlanes` in sync with the active section
 * planes, reconstructed from the serialized `section:change` payload.
 */

import * as THREE from 'three';
import type { Vec3 } from '../../../core/types.js';

export interface SectionPlaneData {
  normal: Vec3;
  point: Vec3;
  active: boolean;
}

/**
 * True if `pt` lies on the cut-away side of any active section plane — i.e. the
 * point sits in the negative half-space of a plane (`(pt − point) · normal < 0`).
 * Picking code uses this to reject raycast hits on geometry a section plane has
 * clipped away. Inactive planes are ignored; an empty list is never clipped.
 */
export function isPointClipped(pt: Vec3, planes: SectionPlaneData[]): boolean {
  return planes.some((p) => {
    if (!p.active) return false;
    const d =
      (pt.x - p.point.x) * p.normal.x +
      (pt.y - p.point.y) * p.normal.y +
      (pt.z - p.point.z) * p.normal.z;
    return d < 0;
  });
}

/** Build `THREE.Plane`s for the active section planes only. */
export function buildClippingPlanes(planes: SectionPlaneData[]): THREE.Plane[] {
  return planes
    .filter((p) => p.active)
    .map((p) =>
      new THREE.Plane().setFromNormalAndCoplanarPoint(
        new THREE.Vector3(p.normal.x, p.normal.y, p.normal.z).normalize(),
        new THREE.Vector3(p.point.x, p.point.y, p.point.z),
      ),
    );
}

/**
 * Assign clipping planes to a material. Only flips `needsUpdate` when the plane
 * count changes — moving an existing plane mutates the plane constants in place
 * and needs no shader recompile, so gizmo drags (which fire `section:change`
 * continuously) don't thrash the program cache. Returns the new count so the
 * caller can track it.
 */
export function applyClippingPlanes(
  mat: THREE.Material,
  planes: THREE.Plane[],
  prevCount: number,
): number {
  mat.clippingPlanes = planes.length > 0 ? planes : null;
  if (planes.length !== prevCount) mat.needsUpdate = true;
  return planes.length;
}
