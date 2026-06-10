import { describe, expect, it, vi } from 'vitest';
import type { InterleavedBufferAttribute } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { ViewerContext } from '../../../core/types.js';

import { OutlineCache } from './outline-cache';
import type { DecodedOutline } from './outline-codec';

const seg = (n: number): number[] => [n, n + 1, n + 2, n + 3, n + 4, n + 5];

/**
 * Three elements: localId 10 (one segment), 20 (zero edges — the encoder
 * normally omits these; present here to exercise the defensive skip), and
 * 30 (two segments). starts must come out [0, 6, 6] by prefix sum.
 */
function makeDecoded(): DecodedOutline {
  return {
    localIds: new Uint32Array([10, 20, 30]),
    lengths: new Uint32Array([6, 0, 12]),
    positions: new Float32Array([...seg(0), ...seg(100), ...seg(200)]),
  };
}

/** Merged float payload of one chunk (LineSegmentsGeometry interleaves 6/segment). */
function chunkFloats(geo: LineSegmentsGeometry): number[] {
  const attr = geo.getAttribute('instanceStart') as InterleavedBufferAttribute;
  return Array.from(attr.data.array as Float32Array);
}

describe('OutlineCache.loadPrecomputed', () => {
  it('seeds the index and resolves whenReady', async () => {
    const cache = new OutlineCache();
    expect(cache.has('m1')).toBe(false);
    cache.loadPrecomputed('m1', makeDecoded());
    expect(cache.has('m1')).toBe(true);
    await expect(cache.whenReady('m1')).resolves.toBeUndefined();
  });

  it('derives starts/slotOf so per-element slices come out right', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());

    // visible filter picks exactly the requested element's span.
    const only10 = cache.buildGeometries('m1', { visible: new Set([10]) });
    expect(only10).toHaveLength(1);
    expect(chunkFloats(only10[0]!)).toEqual(seg(0));

    // localId 30 starts at float 6 (prefix sum across the zero-length slot).
    const only30 = cache.buildGeometries('m1', { visible: new Set([30]) });
    expect(only30).toHaveLength(1);
    expect(chunkFloats(only30[0]!)).toEqual([...seg(100), ...seg(200)]);

    for (const geo of [...only10, ...only30]) geo.dispose();
  });

  it('skips zero-length entries', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    expect(cache.buildGeometries('m1', { visible: new Set([20]) })).toHaveLength(0);
  });

  it('filters by hidden and merges the full model', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());

    const without10 = cache.buildGeometries('m1', { hidden: new Set([10]) });
    expect(without10).toHaveLength(1);
    expect(chunkFloats(without10[0]!)).toEqual([...seg(100), ...seg(200)]);
    for (const geo of without10) geo.dispose();

    const full = cache.buildGeometries('m1', null);
    expect(full).toHaveLength(1);
    expect(chunkFloats(full[0]!)).toEqual([...seg(0), ...seg(100), ...seg(200)]);
    for (const geo of full) geo.dispose();
  });

  it('memoizes the full set via getGeometries', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    const first = cache.getGeometries('m1');
    expect(first).toHaveLength(1);
    expect(cache.getGeometries('m1')).toBe(first);
  });

  it('makes build() a no-op after a precomputed load', async () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());

    const models = vi.fn(() => new Map());
    const ctx = { models } as unknown as ViewerContext;
    await cache.build(ctx, 'm1');

    expect(models).not.toHaveBeenCalled();
    const full = cache.buildGeometries('m1', null);
    expect(chunkFloats(full[0]!)).toEqual([...seg(0), ...seg(100), ...seg(200)]);
    for (const geo of full) geo.dispose();
  });

  it('keeps the first index when called twice', () => {
    const cache = new OutlineCache();
    cache.loadPrecomputed('m1', makeDecoded());
    cache.loadPrecomputed('m1', {
      localIds: new Uint32Array([99]),
      lengths: new Uint32Array([6]),
      positions: new Float32Array(seg(900)),
    });
    expect(cache.buildGeometries('m1', { visible: new Set([99]) })).toHaveLength(0);
    const only10 = cache.buildGeometries('m1', { visible: new Set([10]) });
    expect(chunkFloats(only10[0]!)).toEqual(seg(0));
    for (const geo of only10) geo.dispose();
  });
});
