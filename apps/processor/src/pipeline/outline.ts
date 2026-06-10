/**
 * Backend hard-edge outline artifact: extraction + binary codec.
 *
 * `extractEdgePositions` is a 1:1 port of the viewer's
 * `packages/viewer/src/plugins/3d/shared/edges.ts` — same
 * `THREE.EdgesGeometry` threshold (30°), same transform baking. THE TWO MUST
 * STAY IN SYNC: a backend-produced artifact has to be indistinguishable from
 * the viewer's client-side fallback compute, edge for edge.
 *
 * Binary outline format v1. The stored `.outline.bin` S3 object IS the gzip
 * stream (fflate `gzipSync` here, native `DecompressionStream('gzip')` in the
 * browser). Decompressed payload, all little-endian:
 *
 *   bytes 0-7   ASCII magic "BIMOUTL1"
 *   uint32      elementCount
 *   uint32      totalFloats
 *   Uint32Array localIds[elementCount]
 *   Uint32Array lengths[elementCount]   (floats per element; multiples of 6;
 *                                        zero-edge elements are omitted)
 *   Float32Array positions[totalFloats] (segment endpoints x1,y1,z1,x2,y2,z2,
 *                                        per-mesh transform already baked in)
 *
 * starts[] is NOT stored — consumers derive it by prefix-summing lengths.
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

/** Merge one element's per-mesh edge positions into a single buffer (or null
 * when the element has no hard edges at all — such elements are omitted from
 * the artifact entirely). */
export function elementEdgePositions(
  meshes: readonly RawMeshGeometry[],
  threshold = EDGE_THRESHOLD_DEG,
): Float32Array | null {
  const parts: Float32Array[] = [];
  let totalFloats = 0;
  for (const mesh of meshes) {
    const positions = extractEdgePositions(mesh, threshold);
    if (positions === null) continue;
    parts.push(positions);
    totalFloats += positions.length;
  }
  if (totalFloats === 0) return null;
  if (parts.length === 1) return parts[0] ?? null;
  const out = new Float32Array(totalFloats);
  let off = 0;
  for (const part of parts) {
    out.set(part, off);
    off += part.length;
  }
  return out;
}

export type OutlineEntry = {
  localId: number;
  /** Hard-edge segment endpoints, transform baked; length is a multiple of 6. */
  positions: Float32Array;
};

export type DecodedOutline = {
  elementCount: number;
  totalFloats: number;
  localIds: Uint32Array;
  lengths: Uint32Array;
  positions: Float32Array;
};

export const OUTLINE_MAGIC = 'BIMOUTL1';

const HEADER_BYTES = 8 + 4 + 4; // magic + elementCount + totalFloats

/** Encode entries as gzipped format-v1 bytes (the exact object stored in S3).
 * Bulk arrays are written through typed-array views — platform-endian, which
 * is little-endian on every architecture Node ships for. */
export function encodeOutline(entries: readonly OutlineEntry[]): Uint8Array {
  const elementCount = entries.length;
  let totalFloats = 0;
  for (const entry of entries) totalFloats += entry.positions.length;

  const buf = new ArrayBuffer(HEADER_BYTES + elementCount * 8 + totalFloats * 4);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < OUTLINE_MAGIC.length; i += 1) {
    u8[i] = OUTLINE_MAGIC.charCodeAt(i);
  }
  const dv = new DataView(buf);
  dv.setUint32(8, elementCount, true);
  dv.setUint32(12, totalFloats, true);

  // HEADER_BYTES (16) keeps every view below 4-byte aligned.
  const localIds = new Uint32Array(buf, HEADER_BYTES, elementCount);
  const lengths = new Uint32Array(buf, HEADER_BYTES + elementCount * 4, elementCount);
  const positions = new Float32Array(buf, HEADER_BYTES + elementCount * 8, totalFloats);
  let off = 0;
  for (let slot = 0; slot < entries.length; slot += 1) {
    const entry = entries[slot];
    if (entry === undefined) continue;
    localIds[slot] = entry.localId;
    lengths[slot] = entry.positions.length;
    positions.set(entry.positions, off);
    off += entry.positions.length;
  }

  return gzipSync(u8);
}

/** Decode a gzipped format-v1 artifact. Used by tests and parity checks; the
 * browser path decompresses with native DecompressionStream instead. */
export function decodeOutline(bytes: Uint8Array): DecodedOutline {
  const inflated = gunzipSync(bytes);
  // Typed-array views below need 4-byte alignment within the backing buffer.
  const u8 = inflated.byteOffset % 4 === 0 ? inflated : inflated.slice();
  if (u8.byteLength < HEADER_BYTES) {
    throw new Error('OUTLINE_TRUNCATED: payload shorter than the v1 header');
  }
  for (let i = 0; i < OUTLINE_MAGIC.length; i += 1) {
    if (u8[i] !== OUTLINE_MAGIC.charCodeAt(i)) {
      throw new Error('OUTLINE_BAD_MAGIC: not a format-v1 outline payload');
    }
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const elementCount = dv.getUint32(8, true);
  const totalFloats = dv.getUint32(12, true);
  const expectedBytes = HEADER_BYTES + elementCount * 8 + totalFloats * 4;
  if (u8.byteLength !== expectedBytes) {
    throw new Error(
      `OUTLINE_LENGTH_MISMATCH: expected ${expectedBytes} bytes, got ${u8.byteLength}`,
    );
  }
  const base = u8.byteOffset + HEADER_BYTES;
  return {
    elementCount,
    totalFloats,
    localIds: new Uint32Array(u8.buffer, base, elementCount),
    lengths: new Uint32Array(u8.buffer, base + elementCount * 4, elementCount),
    positions: new Float32Array(u8.buffer, base + elementCount * 8, totalFloats),
  };
}
