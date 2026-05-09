import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

export type SnapType = 'vertex' | 'midpoint' | 'edge';

export interface SnapCandidate {
  point: THREE.Vector3;
  type: SnapType;
  edge?: [THREE.Vector3, THREE.Vector3];
}

export interface ItemSnapData {
  vertices: THREE.Vector3[];
  edges: Array<[THREE.Vector3, THREE.Vector3]>;
  midpoints: THREE.Vector3[];
}

const DEDUP_TOLERANCE = 1e-4;

function isDuplicate(a: THREE.Vector3, list: THREE.Vector3[]): boolean {
  for (const b of list) {
    if (a.distanceToSquared(b) < DEDUP_TOLERANCE * DEDUP_TOLERANCE) return true;
  }
  return false;
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
    return { vertices, edges, midpoints };
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

  return { vertices, edges, midpoints };
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

  // Priority 1: vertices
  if (allowedTypes.includes('vertex')) {
    for (const v of snapData.vertices) {
      const vs = worldToScreen(v, camera, canvas);
      const dSq = screenDistSq(cursorScreen, vs);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = { point: v, type: 'vertex' };
      }
    }
  }

  // Priority 2: midpoints (only beats vertex if strictly closer)
  if (allowedTypes.includes('midpoint')) {
    for (let i = 0; i < snapData.midpoints.length; i++) {
      const mp = snapData.midpoints[i]!;
      const ms = worldToScreen(mp, camera, canvas);
      const dSq = screenDistSq(cursorScreen, ms);
      if (dSq < bestDistSq && (best === null || best.type !== 'vertex')) {
        bestDistSq = dSq;
        const edge = snapData.edges[i]!;
        best = { point: mp, type: 'midpoint', edge };
      }
    }
  }

  // Priority 3: nearest point on edge
  if (allowedTypes.includes('edge')) {
    for (const edge of snapData.edges) {
      const aScreen = worldToScreen(edge[0], camera, canvas);
      const bScreen = worldToScreen(edge[1], camera, canvas);
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
