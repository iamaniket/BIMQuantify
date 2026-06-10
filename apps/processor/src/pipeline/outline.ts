/**
 * Backend hard-edge outline artifact: instanced extraction + binary codec.
 *
 * ThatOpen fragments store geometry INSTANCED — one base shape ("template")
 * placed by many per-element transforms. The artifact mirrors that: unique
 * edge templates in LOCAL space + a per-element instance row carrying a 4x4
 * transform. A model with 10k identical windows stores one window's edges plus
 * 10k cheap transforms instead of 10k baked copies. `extractLocalEdgePositions`
 * is the viewer's edge compute (same `THREE.EdgesGeometry` threshold, 30°) with
 * the transform NO LONGER baked — placement lives in the instance transform and
 * is applied on the GPU.
 *
 * Binary outline format v2. The stored `.outline.bin` S3 object IS the gzip
 * stream (fflate `gzipSync` here, native `DecompressionStream('gzip')` in the
 * browser). Decompressed payload, all little-endian:
 *
 *   bytes 0-7    ASCII magic "BIMOUTL2"
 *   uint32       templateCount
 *   uint32       instanceCount          (rows; an element with N meshes = N rows)
 *   uint32       templateFloatsTotal
 *   Uint32Array  templateLengths[templateCount]      (floats/template; mult. of 6)
 *   Float32Array templatePositions[templateFloatsTotal] (LOCAL segment endpoints
 *                                        x1,y1,z1,x2,y2,z2,…; transform NOT baked)
 *   Uint32Array  instanceLocalIds[instanceCount]
 *   Uint32Array  instanceTemplateIndex[instanceCount]
 *   Float32Array instanceTransforms[instanceCount*16] (column-major 4x4)
 *
 * The 20-byte header keeps every typed-array view 4-byte aligned (each section
 * is a whole number of 4-byte words). Template start offsets are NOT stored —
 * consumers derive them by prefix-summing templateLengths.
 */

import { gunzipSync, gzipSync } from 'fflate';
import * as THREE from 'three';

export interface RawMeshGeometry {
  positions?: Float32Array | Float64Array | null;
  indices?: Uint8Array | Uint16Array | Uint32Array | null;
  transform?: THREE.Matrix4 | null;
}

/** Angle (degrees) above which an edge between two faces counts as "hard". */
export const EDGE_THRESHOLD_DEG = 30;

/**
 * Hard-edge segment endpoints for one mesh in its LOCAL frame (transform NOT
 * applied). Returns null when the mesh has no geometry or no hard edges. The
 * caller bakes nothing — placement is carried by the per-instance transform.
 */
export function extractLocalEdgePositions(
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
  out.set(src);
  edgesGeo.dispose();
  return out;
}

/** Half-degree of slack when deciding two segments lie on one straight line. */
const MERGE_COLLINEAR_SIN_TOL = Math.sin((0.5 * Math.PI) / 180);

/**
 * Collapse runs of collinear, end-to-end segments into single segments.
 *
 * `THREE.EdgesGeometry` emits one segment per source triangle edge, so a long
 * straight edge shared by many triangles arrives pre-split. We weld endpoints
 * (exact float key — EdgesGeometry reuses the source vertex values, so shared
 * corners are bit-identical), then trace each maximal straight run through
 * "pass-through" vertices (degree 2 with both edges collinear and same
 * direction) and emit one segment per run. Corners (cube edges, curve facets)
 * are degree-3 or non-collinear and survive untouched — a 32-gon column keeps
 * its 32 silhouette facets. Pure, side-effect-free; safe to bypass (returns the
 * input shape unchanged when there is nothing to merge).
 */
export function mergeCollinearSegments(positions: Float32Array): Float32Array {
  const segCount = Math.floor(positions.length / 6);
  if (segCount <= 1) return positions;

  // Weld endpoints → integer vertex ids.
  const idOf = new Map<string, number>();
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const weld = (x: number, y: number, z: number): number => {
    const key = `${x}|${y}|${z}`;
    let id = idOf.get(key);
    if (id === undefined) {
      id = px.length;
      idOf.set(key, id);
      px.push(x);
      py.push(y);
      pz.push(z);
    }
    return id;
  };

  // Unique undirected edges + adjacency (vertex id → incident edge indices).
  const seen = new Set<string>();
  const edgeA: number[] = [];
  const edgeB: number[] = [];
  const adj = new Map<number, number[]>();
  const addAdj = (v: number, e: number): void => {
    const list = adj.get(v);
    if (list) list.push(e);
    else adj.set(v, [e]);
  };
  for (let s = 0; s < segCount; s += 1) {
    const o = s * 6;
    const a = weld(positions[o] ?? 0, positions[o + 1] ?? 0, positions[o + 2] ?? 0);
    const b = weld(positions[o + 3] ?? 0, positions[o + 4] ?? 0, positions[o + 5] ?? 0);
    if (a === b) continue; // zero-length
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (seen.has(key)) continue; // duplicate edge
    seen.add(key);
    const e = edgeA.length;
    edgeA.push(a);
    edgeB.push(b);
    addAdj(a, e);
    addAdj(b, e);
  }

  const edgeCount = edgeA.length;
  if (edgeCount === 0) return new Float32Array(0);

  const other = (e: number, v: number): number => (edgeA[e] === v ? edgeB[e]! : edgeA[e]!);

  // Is `v` interior to a straight run? Degree 2 and its two edges point the
  // same way (cross ≈ 0, dot > 0) through `v`.
  const isPassThrough = (v: number): boolean => {
    const list = adj.get(v);
    if (!list || list.length !== 2) return false;
    const a = other(list[0]!, v);
    const b = other(list[1]!, v);
    if (a === b) return false; // folds back on itself
    const vax = px[v]! - px[a]!;
    const vay = py[v]! - py[a]!;
    const vaz = pz[v]! - pz[a]!;
    const vbx = px[b]! - px[v]!;
    const vby = py[b]! - py[v]!;
    const vbz = pz[b]! - pz[v]!;
    const la = Math.hypot(vax, vay, vaz);
    const lb = Math.hypot(vbx, vby, vbz);
    if (la === 0 || lb === 0) return false;
    if (vax * vbx + vay * vby + vaz * vbz <= 0) return false; // opposite dir
    const cx = vay * vbz - vaz * vby;
    const cy = vaz * vbx - vax * vbz;
    const cz = vax * vby - vay * vbx;
    return Math.hypot(cx, cy, cz) <= MERGE_COLLINEAR_SIN_TOL * la * lb;
  };

  const out: number[] = [];
  const visited = new Uint8Array(edgeCount);

  // Extend one end of a run through pass-through vertices, marking edges used.
  const extend = (startEdge: number, startVertex: number): number => {
    let v = startVertex;
    let last = startEdge;
    while (isPassThrough(v)) {
      const list = adj.get(v)!;
      const next = list[0] === last ? list[1]! : list[0]!;
      if (visited[next]) break; // closed loop guard
      visited[next] = 1;
      v = other(next, v);
      last = next;
    }
    return v;
  };

  for (let e0 = 0; e0 < edgeCount; e0 += 1) {
    if (visited[e0]) continue;
    visited[e0] = 1;
    const a = extend(e0, edgeA[e0]!);
    const b = extend(e0, edgeB[e0]!);
    out.push(px[a]!, py[a]!, pz[a]!, px[b]!, py[b]!, pz[b]!);
  }

  return new Float32Array(out);
}

/** One unique edge template: hard-edge segment endpoints in local space. */
export type OutlineTemplate = Float32Array;

/** One element placement of a template. `transform` is a column-major 4x4. */
export type OutlineInstance = {
  localId: number;
  templateIndex: number;
  transform: Float32Array | number[];
};

export type DecodedOutline = {
  templateCount: number;
  instanceCount: number;
  templateFloatsTotal: number;
  /** One Float32Array per template (local segment endpoints, multiple of 6). */
  templates: Float32Array[];
  instanceLocalIds: Uint32Array;
  instanceTemplateIndex: Uint32Array;
  /** Flat column-major 4x4 matrices, 16 floats per instance. */
  instanceTransforms: Float32Array;
};

export const OUTLINE_MAGIC = 'BIMOUTL2';

const HEADER_BYTES = 8 + 4 + 4 + 4; // magic + templateCount + instanceCount + templateFloatsTotal

/** Encode templates + instances as gzipped format-v2 bytes (the exact object
 * stored in S3). Bulk arrays are written through typed-array views —
 * platform-endian, little-endian on every architecture Node ships for. */
export function encodeOutline(
  templates: readonly OutlineTemplate[],
  instances: readonly OutlineInstance[],
): Uint8Array {
  const templateCount = templates.length;
  const instanceCount = instances.length;
  let templateFloatsTotal = 0;
  for (const t of templates) templateFloatsTotal += t.length;

  const byteLength =
    HEADER_BYTES +
    templateCount * 4 + // templateLengths
    templateFloatsTotal * 4 + // templatePositions
    instanceCount * 4 + // instanceLocalIds
    instanceCount * 4 + // instanceTemplateIndex
    instanceCount * 64; // instanceTransforms (16 floats)

  const buf = new ArrayBuffer(byteLength);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < OUTLINE_MAGIC.length; i += 1) {
    u8[i] = OUTLINE_MAGIC.charCodeAt(i);
  }
  const dv = new DataView(buf);
  dv.setUint32(8, templateCount, true);
  dv.setUint32(12, instanceCount, true);
  dv.setUint32(16, templateFloatsTotal, true);

  let off = HEADER_BYTES;
  const templateLengths = new Uint32Array(buf, off, templateCount);
  off += templateCount * 4;
  const templatePositions = new Float32Array(buf, off, templateFloatsTotal);
  off += templateFloatsTotal * 4;
  const instanceLocalIds = new Uint32Array(buf, off, instanceCount);
  off += instanceCount * 4;
  const instanceTemplateIndex = new Uint32Array(buf, off, instanceCount);
  off += instanceCount * 4;
  const instanceTransforms = new Float32Array(buf, off, instanceCount * 16);

  let tOff = 0;
  for (let i = 0; i < templateCount; i += 1) {
    const t = templates[i]!;
    templateLengths[i] = t.length;
    templatePositions.set(t, tOff);
    tOff += t.length;
  }
  for (let i = 0; i < instanceCount; i += 1) {
    const inst = instances[i]!;
    instanceLocalIds[i] = inst.localId;
    instanceTemplateIndex[i] = inst.templateIndex;
    instanceTransforms.set(inst.transform, i * 16);
  }

  return gzipSync(u8);
}

/** Decode a gzipped format-v2 artifact. Used by tests and parity checks; the
 * browser path decompresses with native DecompressionStream instead. */
export function decodeOutline(bytes: Uint8Array): DecodedOutline {
  const inflated = gunzipSync(bytes);
  // Typed-array views below need 4-byte alignment within the backing buffer.
  const u8 = inflated.byteOffset % 4 === 0 ? inflated : inflated.slice();
  if (u8.byteLength < HEADER_BYTES) {
    throw new Error('OUTLINE_TRUNCATED: payload shorter than the v2 header');
  }
  for (let i = 0; i < OUTLINE_MAGIC.length; i += 1) {
    if (u8[i] !== OUTLINE_MAGIC.charCodeAt(i)) {
      throw new Error('OUTLINE_BAD_MAGIC: not a format-v2 outline payload');
    }
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const templateCount = dv.getUint32(8, true);
  const instanceCount = dv.getUint32(12, true);
  const templateFloatsTotal = dv.getUint32(16, true);
  const expectedBytes =
    HEADER_BYTES +
    templateCount * 4 +
    templateFloatsTotal * 4 +
    instanceCount * 4 +
    instanceCount * 4 +
    instanceCount * 64;
  if (u8.byteLength !== expectedBytes) {
    throw new Error(
      `OUTLINE_LENGTH_MISMATCH: expected ${expectedBytes} bytes, got ${u8.byteLength}`,
    );
  }

  let base = u8.byteOffset + HEADER_BYTES;
  const templateLengths = new Uint32Array(u8.buffer, base, templateCount);
  base += templateCount * 4;
  const templatePositions = new Float32Array(u8.buffer, base, templateFloatsTotal);
  base += templateFloatsTotal * 4;
  const instanceLocalIds = new Uint32Array(u8.buffer, base, instanceCount).slice();
  base += instanceCount * 4;
  const instanceTemplateIndex = new Uint32Array(u8.buffer, base, instanceCount).slice();
  base += instanceCount * 4;
  const instanceTransforms = new Float32Array(u8.buffer, base, instanceCount * 16).slice();

  const templates: Float32Array[] = [];
  let tOff = 0;
  for (let i = 0; i < templateCount; i += 1) {
    const len = templateLengths[i]!;
    templates.push(templatePositions.slice(tOff, tOff + len));
    tOff += len;
  }

  return {
    templateCount,
    instanceCount,
    templateFloatsTotal,
    templates,
    instanceLocalIds,
    instanceTemplateIndex,
    instanceTransforms,
  };
}
