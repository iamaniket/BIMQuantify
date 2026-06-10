import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
  decodeOutline,
  encodeOutline,
  extractLocalEdgePositions,
  mergeCollinearSegments,
  type OutlineInstance,
  type OutlineTemplate,
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

describe('extractLocalEdgePositions', () => {
  it('finds exactly the 12 hard edges of an indexed cube, in local space', () => {
    const positions = extractLocalEdgePositions(cube());
    expect(positions).not.toBeNull();
    // 12 edges × 2 endpoints × 3 floats = 72; the coplanar face diagonals
    // fall under the 30° threshold and are excluded.
    expect(positions?.length).toBe(72);
    // Every endpoint is a cube corner — and crucially NOT transformed.
    for (const v of positions ?? []) {
      expect(v === 0 || v === 1).toBe(true);
    }
  });

  it('returns null for empty or missing geometry', () => {
    expect(extractLocalEdgePositions({ positions: new Float32Array(0) })).toBeNull();
    expect(extractLocalEdgePositions({})).toBeNull();
  });
});

describe('mergeCollinearSegments', () => {
  it('merges a subdivided straight edge into one segment', () => {
    // (0,0,0)-(1,0,0) and (1,0,0)-(2,0,0) are collinear and share a vertex.
    const merged = mergeCollinearSegments(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 2, 0, 0]),
    );
    expect(merged.length).toBe(6);
    expect([...merged]).toEqual([0, 0, 0, 2, 0, 0]);
  });

  it('keeps an L-shape as two segments (corner is not collinear)', () => {
    const merged = mergeCollinearSegments(
      new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0]),
    );
    expect(merged.length).toBe(12);
  });

  it('leaves the cube untouched — every corner is a 3-way junction', () => {
    const edges = extractLocalEdgePositions(cube());
    const merged = mergeCollinearSegments(edges!);
    expect(merged.length).toBe(72); // still 12 segments
  });

  it('collapses a 4-part straight run into one segment', () => {
    const merged = mergeCollinearSegments(
      new Float32Array([
        0, 0, 0, 1, 0, 0,
        1, 0, 0, 2, 0, 0,
        2, 0, 0, 3, 0, 0,
        3, 0, 0, 4, 0, 0,
      ]),
    );
    expect(merged.length).toBe(6);
    expect([...merged]).toEqual([0, 0, 0, 4, 0, 0]);
  });
});

describe('outline codec (v2)', () => {
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const translate = (x: number, y: number, z: number): number[] => [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1, // column-major
  ];

  it('round-trips templates and instances through encode/decode', () => {
    const templates: OutlineTemplate[] = [
      new Float32Array([0, 0, 0, 1, 0, 0]),
      new Float32Array([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1.5]),
    ];
    const instances: OutlineInstance[] = [
      { localId: 7, templateIndex: 0, transform: ident },
      { localId: 42, templateIndex: 1, transform: translate(10, 20, 30) },
      { localId: 42, templateIndex: 0, transform: ident },
    ];

    const decoded = decodeOutline(encodeOutline(templates, instances));
    expect(decoded.templateCount).toBe(2);
    expect(decoded.instanceCount).toBe(3);
    expect(decoded.templateFloatsTotal).toBe(18);
    expect([...decoded.templates[0]!]).toEqual([0, 0, 0, 1, 0, 0]);
    expect([...decoded.templates[1]!]).toEqual([0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1.5]);
    expect([...decoded.instanceLocalIds]).toEqual([7, 42, 42]);
    expect([...decoded.instanceTemplateIndex]).toEqual([0, 1, 0]);
    // Second instance carries the translation in the last column (12,13,14).
    expect(decoded.instanceTransforms[16 + 12]).toBeCloseTo(10, 5);
    expect(decoded.instanceTransforms[16 + 13]).toBeCloseTo(20, 5);
    expect(decoded.instanceTransforms[16 + 14]).toBeCloseTo(30, 5);
    expect(decoded.instanceTransforms).toHaveLength(48);
  });

  it('round-trips an empty model', () => {
    const decoded = decodeOutline(encodeOutline([], []));
    expect(decoded.templateCount).toBe(0);
    expect(decoded.instanceCount).toBe(0);
    expect(decoded.templateFloatsTotal).toBe(0);
    expect(decoded.templates).toHaveLength(0);
    expect(decoded.instanceLocalIds).toHaveLength(0);
    expect(decoded.instanceTransforms).toHaveLength(0);
  });

  it('rejects a gzip stream that is not a v2 outline payload', () => {
    const bogus = gzipSync(new TextEncoder().encode('NOTOUTL2plus-some-junk'));
    expect(() => decodeOutline(bogus)).toThrow(/OUTLINE_BAD_MAGIC/);
  });
});
