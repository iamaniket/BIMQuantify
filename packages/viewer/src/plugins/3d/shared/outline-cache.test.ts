import { describe, expect, it } from 'vitest';
import type { InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import { OutlineCache } from './outline-cache';
import type { DecodedOutline } from './outline-codec';

const seg = (n: number): number[] => [n, n + 1, n + 2, n + 3, n + 4, n + 5];
const ident = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * Two templates: index 0 = one segment, index 1 = two segments. Three element
 * placements (all identity transforms so expansion equals the template):
 *   localId 10 → template 0
 *   localId 30 → template 1
 *   localId 50 → templates 0 AND 1 (a two-mesh element)
 */
function makeDecoded(): DecodedOutline {
  return {
    templates: [new Float32Array(seg(0)), new Float32Array([...seg(100), ...seg(200)])],
    instanceLocalIds: new Uint32Array([10, 30, 50, 50]),
    instanceTemplateIndex: new Uint32Array([0, 1, 0, 1]),
    instanceTransforms: new Float32Array([...ident(), ...ident(), ...ident(), ...ident()]),
  };
}

/** Merged float payload of one chunk (LineSegmentsGeometry interleaves 6/segment). */
function chunkFloats(geo: LineSegmentsGeometry): number[] {
  const attr = geo.getAttribute('instanceStart') as InterleavedBufferAttribute;
  return Array.from(attr.data.array as Float32Array);
}

describe('OutlineCache.loadPrecomputed', () => {
  it('seeds the model and resolves whenReady', async () => {
    const cache = new OutlineCache();
    expect(cache.has('m1')).toBe(false);
    cache.loadPrecomputed('m1', makeDecoded());
    expect(cache.has('m1')).toBe(true);
    await expect(cache.whenReady('m1')).resolves.toBeUndefined();
  });

  it('expands a single-template element on demand', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());

    const only10 = cache.buildGeometries('m1', { visible: new Set([10]) });
    expect(only10).toHaveLength(1);
    expect(chunkFloats(only10[0]!)).toEqual(seg(0));

    const only30 = cache.buildGeometries('m1', { visible: new Set([30]) });
    expect(chunkFloats(only30[0]!)).toEqual([...seg(100), ...seg(200)]);

    for (const geo of [...only10, ...only30]) geo.dispose();
  });

  it('concatenates all meshes of a multi-template element', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    const pos = cache.getItemPositions('m1', 50);
    expect(pos).not.toBeNull();
    expect([...pos!]).toEqual([...seg(0), ...seg(100), ...seg(200)]);
  });

  it('applies the instance transform when expanding', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', {
      templates: [new Float32Array([0, 1, 2, 3, 4, 5])],
      instanceLocalIds: new Uint32Array([7]),
      instanceTemplateIndex: new Uint32Array([0]),
      // translate(10,20,30) in column-major form.
      instanceTransforms: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]),
    });
    const pos = cache.getItemPositions('m1', 7);
    expect([...pos!]).toEqual([10, 21, 32, 13, 24, 35]);
  });

  it('returns null / empty for an unknown element', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    expect(cache.getItemPositions('m1', 999)).toBeNull();
    expect(cache.buildGeometries('m1', { visible: new Set([999]) })).toHaveLength(0);
  });

  it('filters by hidden and merges the full model', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());

    const without10 = cache.buildGeometries('m1', { hidden: new Set([10, 50]) });
    expect(without10).toHaveLength(1);
    expect(chunkFloats(without10[0]!)).toEqual([...seg(100), ...seg(200)]);
    for (const geo of without10) geo.dispose();

    const full = cache.buildGeometries('m1', null);
    expect(chunkFloats(full[0]!)).toEqual([
      ...seg(0), // localId 10
      ...seg(100), ...seg(200), // localId 30
      ...seg(0), ...seg(100), ...seg(200), // localId 50 (two meshes)
    ]);
    for (const geo of full) geo.dispose();
  });

  it('memoizes the full set via getGeometries', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    const first = cache.getGeometries('m1');
    expect(first).toHaveLength(1);
    expect(cache.getGeometries('m1')).toBe(first);
  });

  it('keeps the first model when loaded twice', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    cache.loadPrecomputed('m1', {
      templates: [new Float32Array(seg(900))],
      instanceLocalIds: new Uint32Array([99]),
      instanceTemplateIndex: new Uint32Array([0]),
      instanceTransforms: new Float32Array(ident()),
    });
    expect(cache.buildGeometries('m1', { visible: new Set([99]) })).toHaveLength(0);
    const only10 = cache.buildGeometries('m1', { visible: new Set([10]) });
    expect(chunkFloats(only10[0]!)).toEqual(seg(0));
    for (const geo of only10) geo.dispose();
  });

  it('exposes raw instanced data via getModel', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    const model = cache.getModel('m1');
    expect(model?.templates).toHaveLength(2);
    // template 0 is placed by localId 10 and 50; template 1 by 30 and 50.
    expect(model?.instancesByTemplate[0]!.map((r) => r.localId)).toEqual([10, 50]);
    expect(model?.instancesByTemplate[1]!.map((r) => r.localId)).toEqual([30, 50]);
  });
});
