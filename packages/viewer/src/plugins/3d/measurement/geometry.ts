/**
 * Pure geometry helpers for the measurement plugin — dot/line/arc/polygon
 * construction and polygon math. Anything that depended on plugin-scoped
 * mutable state (the model bounds via `ctxRef`, shared materials, the live
 * `config` object) takes that state as an explicit parameter instead of
 * closing over it, so these functions are pure with respect to module state.
 * Imports only `three` and the layer constant — never `index.ts` — so there
 * is no circular dependency.
 */

import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';

/**
 * Largest dimension of the union of all model bounding boxes (min 1), or 10
 * when there are no models. `boxes` is the iterable of per-model `box` values
 * (the caller passes `ctxRef.models()` mapped to `model.box`).
 */
export function getModelScale(boxes: Iterable<THREE.Box3 | null | undefined>): number {
  const box = new THREE.Box3();
  for (const mBox of boxes) {
    if (mBox && !mBox.isEmpty()) box.union(mBox);
  }
  if (box.isEmpty()) return 10;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(size.x, size.y, size.z, 1);
}

export function createDot(
  pos: THREE.Vector3,
  modelScale: number,
  dotScale: number,
  geo: THREE.SphereGeometry,
  mat: THREE.Material,
): THREE.Mesh {
  const scale = Math.max(modelScale / 200, 0.02) * dotScale;
  const dot = new THREE.Mesh(geo, mat);
  dot.position.copy(pos);
  dot.scale.setScalar(scale / 0.05);
  dot.renderOrder = 999;
  dot.layers.set(LAYER_OVERLAY);
  return dot;
}

export function createDashedLine(
  a: THREE.Vector3,
  b: THREE.Vector3,
  color: number,
  modelScale: number,
): THREE.Line {
  const mat = new THREE.LineDashedMaterial({
    color,
    depthTest: false,
    dashSize: modelScale / 80,
    gapSize: modelScale / 120,
  });
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 998;
  return line;
}

export function createRightAngleIndicator(
  corner: THREE.Vector3,
  dirH: THREE.Vector3,
  dirV: THREE.Vector3,
  size: number,
  color: number,
): THREE.Line {
  const hNorm = dirH.clone().normalize();
  const vNorm = dirV.clone().normalize();
  const pts = [
    corner.clone().addScaledVector(hNorm, size),
    corner.clone().addScaledVector(hNorm, size).addScaledVector(vNorm, size),
    corner.clone().addScaledVector(vNorm, size),
  ];
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 998;
  return line;
}

export function createArc(
  vertex: THREE.Vector3,
  dirA: THREE.Vector3,
  dirB: THREE.Vector3,
  angle: number,
  radius: number,
  mat: THREE.Material,
): THREE.Line {
  const segments = Math.max(Math.ceil(Math.abs(angle) / (Math.PI / 36)), 8);
  const points: THREE.Vector3[] = [];

  const nA = dirA.clone().normalize();
  const nB = dirB.clone().normalize();

  // Build a local frame: X = nA, compute Y perpendicular in the plane of nA/nB
  const cross = new THREE.Vector3().crossVectors(nA, nB).normalize();
  const perpY = new THREE.Vector3().crossVectors(cross, nA).normalize();

  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * angle;
    const dir = new THREE.Vector3()
      .addScaledVector(nA, Math.cos(t))
      .addScaledVector(perpY, Math.sin(t))
      .normalize();
    points.push(vertex.clone().addScaledVector(dir, radius));
  }

  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const arc = new THREE.Line(geo, mat);
  arc.renderOrder = 999;
  return arc;
}

export function computePolygonNormal(pts: THREE.Vector3[]): THREE.Vector3 {
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    n.x += (cur.y - next.y) * (cur.z + next.z);
    n.y += (cur.z - next.z) * (cur.x + next.x);
    n.z += (cur.x - next.x) * (cur.y + next.y);
  }
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
  return n.normalize();
}

export function computePolygonArea(pts: THREE.Vector3[]): number {
  if (pts.length < 3) return 0;
  const normal = computePolygonNormal(pts);
  const cross = new THREE.Vector3();
  const total = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]!;
    const next = pts[(i + 1) % pts.length]!;
    cross.crossVectors(cur, next);
    total.add(cross);
  }
  return Math.abs(total.dot(normal)) * 0.5;
}

export function computePolygonCentroid(pts: THREE.Vector3[]): THREE.Vector3 {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  return c;
}

export function createPolygonFill(
  pts: THREE.Vector3[],
  color: number,
  opacity: number,
  parent: THREE.Object3D,
): THREE.Mesh {
  const normal = computePolygonNormal(pts);
  const up = Math.abs(normal.y) > 0.99
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
  const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
  const origin = pts[0]!;

  const shape = new THREE.Shape();
  const projected = pts.map((p) => {
    const d = new THREE.Vector3().subVectors(p, origin);
    return new THREE.Vector2(d.dot(xAxis), d.dot(yAxis));
  });
  shape.moveTo(projected[0]!.x, projected[0]!.y);
  for (let i = 1; i < projected.length; i++) {
    shape.lineTo(projected[i]!.x, projected[i]!.y);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  const positions = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    const u = positions.getX(i);
    const v = positions.getY(i);
    const world = origin.clone()
      .addScaledVector(xAxis, u)
      .addScaledVector(yAxis, v);
    positions.setXYZ(i, world.x, world.y, world.z);
  }
  positions.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 997;
  mesh.layers.set(LAYER_OVERLAY);
  parent.add(mesh);
  return mesh;
}

export function applyAxisLock(
  anchor: THREE.Vector3,
  target: THREE.Vector3,
): { point: THREE.Vector3; axis: 'x' | 'y' | 'z' } {
  const delta = new THREE.Vector3().subVectors(target, anchor);
  const absX = Math.abs(delta.x);
  const absY = Math.abs(delta.y);
  const absZ = Math.abs(delta.z);

  let axis: 'x' | 'y' | 'z';
  const locked = anchor.clone();

  if (absX >= absY && absX >= absZ) {
    axis = 'x';
    locked.x += delta.x;
  } else if (absY >= absX && absY >= absZ) {
    axis = 'y';
    locked.y += delta.y;
  } else {
    axis = 'z';
    locked.z += delta.z;
  }

  return { point: locked, axis };
}
