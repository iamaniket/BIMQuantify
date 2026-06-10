import { gzipSync } from 'fflate';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  decodeOutline,
  encodeOutline,
  extractEdgePositions,
  type OutlineEntry,
} from '../src/pipeline/outline.js';

// Indexed unit cube: 8 vertices, 12 triangles with consistent outward winding.
// Every cube edge sits between two perpendicular faces (90° > 30° threshold);
// the face diagonals sit between coplanar triangles (0°) and must be dropped.
const cube = (): { positions: Float32Array; indices: Uint32Array } => ({
  positions: new Float32Array([
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, // bottom ring (z=0)
    0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, // top ring (z=1)
  ]),
  indices: new Uint32Array([
    0, 2, 1, 0, 3, 2, // bottom (z=0)
    4, 5, 6, 4, 6, 7, // top (z=1)
    0, 1, 5, 0, 5, 4, // front (y=0)
    2, 3, 7, 2, 7, 6, // back (y=1)
    0, 4, 7, 0, 7, 3, // left (x=0)
    1, 2, 6, 1, 6, 5, // right (x=1)
  ]),
});

describe('extractEdgePositions', () => {
  it('finds exactly the 12 hard edges of an indexed cube', () => {
    const positions = extractEdgePositions(cube());
    expect(positions).not.toBeNull();
    // 12 edges × 2 endpoints × 3 floats = 72; the coplanar face diagonals
    // fall under the 30° threshold and are excluded.
    expect(positions?.length).toBe(72);
    // Every endpoint is a cube corner.
    for (const v of positions ?? []) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('returns null for empty or missing geometry', () => {
    expect(extractEdgePositions({ positions: new Float32Array(0) })).toBeNull();
    expect(extractEdgePositions({})).toBeNull();
  });

  it('bakes the mesh transform into the endpoints', () => {
    const local = extractEdgePositions(cube());
    const transform = new THREE.Matrix4().makeTranslation(10, 20, 30);
    const world = extractEdgePositions({ ...cube(), transform });
    expect(local).not.toBeNull();
    expect(world).not.toBeNull();
    expect(world?.length).toBe(local?.length);
    for (let i = 0; i < (world?.length ?? 0); i += 3) {
      expect(world?.[i]).toBeCloseTo((local?.[i] ?? 0) + 10, 5);
      expect(world?.[i + 1]).toBeCloseTo((local?.[i + 1] ?? 0) + 20, 5);
      expect(world?.[i + 2]).toBeCloseTo((local?.[i + 2] ?? 0) + 30, 5);
    }
  });
});

describe('outline codec', () => {
  it('round-trips entries through encode/decode', () => {
    const entries: OutlineEntry[] = [
      { localId: 7, positions: new Float32Array([0, 0, 0, 1, 0, 0]) },
      {
        localId: 42,
        positions: new Float32Array([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1.5]),
      },
    ];
    const decoded = decodeOutline(encodeOutline(entries));
    expect(decoded.elementCount).toBe(2);
    expect(decoded.totalFloats).toBe(18);
    expect([...decoded.localIds]).toEqual([7, 42]);
    expect([...decoded.lengths]).toEqual([6, 12]);
    expect([...decoded.positions]).toEqual([
      0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1.5,
    ]);
  });

  it('round-trips an empty model', () => {
    const decoded = decodeOutline(encodeOutline([]));
    expect(decoded.elementCount).toBe(0);
    expect(decoded.totalFloats).toBe(0);
    expect(decoded.localIds).toHaveLength(0);
    expect(decoded.lengths).toHaveLength(0);
    expect(decoded.positions).toHaveLength(0);
  });

  it('rejects a gzip stream that is not a v1 outline payload', () => {
    const bogus = gzipSync(new TextEncoder().encode('NOTOUTL1plus-some-junk'));
    expect(() => decodeOutline(bogus)).toThrow(/OUTLINE_BAD_MAGIC/);
  });
});
