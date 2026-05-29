/**
 * Shared edge extraction.
 *
 * Turns one mesh's triangle geometry into a flat array of hard-edge
 * segment endpoints ([x1,y1,z1, x2,y2,z2, ...]) baked into world space.
 * That format feeds both `LineSegmentsGeometry.setPositions` (per-item
 * fat lines in EdgeOverlay) and the model-wide outline accumulator
 * (OutlineCache), so the edge logic lives in exactly one place.
 */

import * as THREE from 'three';

export interface RawMeshGeometry {
  positions?: Float32Array | Float64Array | null;
  indices?: Uint8Array | Uint16Array | Uint32Array | null;
  transform?: THREE.Matrix4 | null;
}

/** Angle (degrees) above which an edge between two faces counts as "hard". */
export const EDGE_THRESHOLD_DEG = 30;

export function extractEdgePositions(
  mesh: RawMeshGeometry,
  threshold = EDGE_THRESHOLD_DEG,
): Float32Array | null {
  if (!mesh.positions || mesh.positions.length === 0) return null;

  const bufGeo = new THREE.BufferGeometry();
  bufGeo.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  if (mesh.indices) {
    bufGeo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  }

  const edgesGeo = new THREE.EdgesGeometry(bufGeo, threshold);
  bufGeo.dispose();

  const src = edgesGeo.getAttribute('position').array as ArrayLike<number>;
  if (src.length === 0) {
    edgesGeo.dispose();
    return null;
  }

  const out = new Float32Array(src.length);
  const m = mesh.transform;
  if (m) {
    const v = new THREE.Vector3();
    for (let i = 0; i < src.length; i += 3) {
      v.set(src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0).applyMatrix4(m);
      out[i] = v.x;
      out[i + 1] = v.y;
      out[i + 2] = v.z;
    }
  } else {
    out.set(src);
  }

  edgesGeo.dispose();
  return out;
}
