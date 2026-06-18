import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

export type SnapType = 'vertex' | 'midpoint' | 'edge' | 'intersection';

export interface SnapCandidate {
  point: THREE.Vector3;
  type: SnapType;
  edge?: [THREE.Vector3, THREE.Vector3];
}

export interface ItemSnapData {
  vertices: THREE.Vector3[];
  edges: Array<[THREE.Vector3, THREE.Vector3]>;
  midpoints: THREE.Vector3[];
  intersections: THREE.Vector3[];
}

const DEDUP_TOLERANCE = 1e-4;
const MAX_EDGES_FOR_INTERSECTIONS = 500;

function isDuplicate(a: THREE.Vector3, list: THREE.Vector3[]): boolean {
  for (const b of list) {
    if (a.distanceToSquared(b) < DEDUP_TOLERANCE * DEDUP_TOLERANCE) return true;
  }
  return false;
}

function segmentSegmentClosest(
  a1: THREE.Vector3, a2: THREE.Vector3,
  b1: THREE.Vector3, b2: THREE.Vector3,
): { point: THREE.Vector3; distSq: number } | null {
  const d1 = new THREE.Vector3().subVectors(a2, a1);
  const d2 = new THREE.Vector3().subVectors(b2, b1);
  const r = new THREE.Vector3().subVectors(a1, b1);

  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);

  if (a < 1e-10 || e < 1e-10) return null;

  const b = d1.dot(d2);
  const c = d1.dot(r);
  const denom = a * e - b * b;

  if (Math.abs(denom) < 1e-10) return null; // parallel

  let s = (b * f - c * e) / denom;
  let t = (a * f - b * c) / denom;

  s = Math.max(0, Math.min(1, s));
  t = Math.max(0, Math.min(1, t));

  const pA = a1.clone().addScaledVector(d1, s);
  const pB = b1.clone().addScaledVector(d2, t);
  const distSq = pA.distanceToSquared(pB);

  const midpoint = pA.clone().lerp(pB, 0.5);
  return { point: midpoint, distSq };
}

function computeIntersections(edges: Array<[THREE.Vector3, THREE.Vector3]>): THREE.Vector3[] {
  if (edges.length > MAX_EDGES_FOR_INTERSECTIONS) return [];

  const intersections: THREE.Vector3[] = [];
  const epsSq = DEDUP_TOLERANCE * DEDUP_TOLERANCE;

  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const [a1, a2] = edges[i]!;
      const [b1, b2] = edges[j]!;

      // Skip if edges share an endpoint (that's just a vertex)
      if (a1.distanceToSquared(b1) < epsSq || a1.distanceToSquared(b2) < epsSq ||
          a2.distanceToSquared(b1) < epsSq || a2.distanceToSquared(b2) < epsSq) {
        continue;
      }

      const result = segmentSegmentClosest(a1, a2, b1, b2);
      if (!result || result.distSq > epsSq) continue;

      if (!isDuplicate(result.point, intersections)) {
        intersections.push(result.point);
      }
    }
  }

  return intersections;
}

export async function extractSnapData(
  model: FRAGS.FragmentsModel,
  localId: number,
): Promise<ItemSnapData> {
  const vertices: THREE.Vector3[] = [];
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];
  const midpoints: THREE.Vector3[] = [];

  let meshDataArrays: Awaited<ReturnType<typeof model.getItemsGeometry>>;
  try {
    meshDataArrays = await model.getItemsGeometry([localId]);
  } catch {
    return { vertices, edges, midpoints, intersections: [] };
  }

  for (const meshDataArr of meshDataArrays) {
    for (const meshData of meshDataArr) {
      if (!meshData.positions) continue;

      const bufGeo = new THREE.BufferGeometry();
      bufGeo.setAttribute(
        'position',
        new THREE.BufferAttribute(meshData.positions, 3),
      );
      if (meshData.indices) {
        bufGeo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
      }

      const edgesGeo = new THREE.EdgesGeometry(bufGeo, 30);
      bufGeo.dispose();

      const posAttr = edgesGeo.getAttribute('position') as THREE.BufferAttribute;
      const transform = meshData.transform ?? null;

      for (let i = 0; i < posAttr.count; i += 2) {
        const a = new THREE.Vector3().fromBufferAttribute(posAttr, i);
        const b = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1);

        if (transform) {
          a.applyMatrix4(transform);
          b.applyMatrix4(transform);
        }

        edges.push([a, b]);
        midpoints.push(new THREE.Vector3().lerpVectors(a, b, 0.5));

        if (!isDuplicate(a, vertices)) vertices.push(a);
        if (!isDuplicate(b, vertices)) vertices.push(b);
      }

      edgesGeo.dispose();
    }
  }

  const intersections = computeIntersections(edges);

  return { vertices, edges, midpoints, intersections };
}

export function worldToScreen(
  point: THREE.Vector3,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return {
    x: ((ndc.x + 1) / 2) * canvas.clientWidth,
    y: ((1 - ndc.y) / 2) * canvas.clientHeight,
  };
}

// Reused across the projection loop in findBestSnap so a dense item doesn't
// allocate a Vector3 per snap point. Safe because findBestSnap is synchronous
// and called one move at a time.
const _projScratch = new THREE.Vector3();

function screenDistSq(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function closestPointOnSegmentScreen(
  cursor: { x: number; y: number },
  aScreen: { x: number; y: number },
  bScreen: { x: number; y: number },
): { t: number; distSq: number } {
  const dx = bScreen.x - aScreen.x;
  const dy = bScreen.y - aScreen.y;
  const lenSq = dx * dx + dy * dy;

  if (lenSq < 1e-8) {
    return { t: 0, distSq: screenDistSq(cursor, aScreen) };
  }

  const t = Math.max(
    0,
    Math.min(1, ((cursor.x - aScreen.x) * dx + (cursor.y - aScreen.y) * dy) / lenSq),
  );
  const proj = { x: aScreen.x + t * dx, y: aScreen.y + t * dy };
  return { t, distSq: screenDistSq(cursor, proj) };
}

export function findBestSnap(
  snapData: ItemSnapData,
  cursorScreen: { x: number; y: number },
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  thresholdPx: number,
  allowedTypes: readonly SnapType[],
): SnapCandidate | null {
  const threshSq = thresholdPx * thresholdPx;
  let best: SnapCandidate | null = null;
  let bestDistSq = threshSq;

  // Hoist the layout reads OUT of the per-snap-point loop: worldToScreen used to
  // read canvas.clientWidth/clientHeight on every projection, so a dense item
  // forced one layout read per vertex/edge/midpoint on every pointer-move. Read
  // them once and project through a shared scratch vector (no per-point alloc).
  // Numerics are identical to worldToScreen.
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const sa = { x: 0, y: 0 };
  const sb = { x: 0, y: 0 };
  const toScreen = (point: THREE.Vector3, out: { x: number; y: number }): { x: number; y: number } => {
    _projScratch.copy(point).project(camera);
    out.x = ((_projScratch.x + 1) / 2) * w;
    out.y = ((1 - _projScratch.y) / 2) * h;
    return out;
  };

  // Priority 1: vertices
  if (allowedTypes.includes('vertex')) {
    for (const v of snapData.vertices) {
      const dSq = screenDistSq(cursorScreen, toScreen(v, sa));
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = { point: v, type: 'vertex' };
      }
    }
  }

  // Priority 2: intersections
  if (allowedTypes.includes('intersection')) {
    for (const ip of snapData.intersections) {
      const dSq = screenDistSq(cursorScreen, toScreen(ip, sa));
      if (dSq < bestDistSq && (best === null || best.type !== 'vertex')) {
        bestDistSq = dSq;
        best = { point: ip, type: 'intersection' };
      }
    }
  }

  // Priority 3: midpoints (only beats vertex/intersection if strictly closer)
  if (allowedTypes.includes('midpoint')) {
    for (let i = 0; i < snapData.midpoints.length; i++) {
      const mp = snapData.midpoints[i]!;
      const dSq = screenDistSq(cursorScreen, toScreen(mp, sa));
      if (dSq < bestDistSq && (best === null || (best.type !== 'vertex' && best.type !== 'intersection'))) {
        bestDistSq = dSq;
        const edge = snapData.edges[i]!;
        best = { point: mp, type: 'midpoint', edge };
      }
    }
  }

  // Priority 4: nearest point on edge
  if (allowedTypes.includes('edge')) {
    for (const edge of snapData.edges) {
      const aScreen = toScreen(edge[0], sa);
      const bScreen = toScreen(edge[1], sb);
      const { t, distSq } = closestPointOnSegmentScreen(cursorScreen, aScreen, bScreen);

      if (distSq < bestDistSq && (best === null || best.type === 'edge')) {
        bestDistSq = distSq;
        const worldPoint = new THREE.Vector3().lerpVectors(edge[0], edge[1], t);
        best = { point: worldPoint, type: 'edge', edge };
      }
    }
  }

  return best;
}
