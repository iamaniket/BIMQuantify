import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  collectVisibleSolidBoxes,
  type ShadowBoxCacheEntry,
} from './visibleBox.js';
import type { ItemId, ViewerContext } from './types.js';

/** Minimal FragmentsModel stand-in: the box query surface the collector touches. */
function fakeModel(opts: {
  ids: number[];
  boxes: THREE.Box3[];
  box: THREE.Box3;
  onGetBoxes?: () => void;
  onGetLocalIds?: () => void;
}) {
  return {
    box: opts.box,
    getLocalIds: async (): Promise<number[]> => {
      opts.onGetLocalIds?.();
      return opts.ids;
    },
    getBoxes: async (): Promise<THREE.Box3[]> => {
      opts.onGetBoxes?.();
      return opts.boxes;
    },
  };
}

function fakeCtx(models: Map<string, unknown>): ViewerContext {
  return { models: () => models } as unknown as ViewerContext;
}

describe('collectVisibleSolidBoxes', () => {
  it('returns every element box plus their tight union when nothing is hidden', async () => {
    const modelBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 3, 10),
    );
    const boxes = [
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2)),
      new THREE.Box3(new THREE.Vector3(8, 0, 8), new THREE.Vector3(10, 2, 10)),
    ];
    const ctx = fakeCtx(
      new Map([['m', fakeModel({ ids: [1, 2], boxes, box: modelBox })]]),
    );
    const cache = new Map<string, ShadowBoxCacheEntry>();

    const { boxes: out, framingBox } = await collectVisibleSolidBoxes(ctx, {
      hidden: [],
      xrayed: [],
      boxCache: cache,
    });

    expect(out).toHaveLength(2);
    expect(framingBox.min.toArray()).toEqual([0, 0, 0]);
    expect(framingBox.max.toArray()).toEqual([10, 2, 10]);
    expect(cache.has('m')).toBe(true); // queried once, cached for reuse
  });

  it('excludes hidden and x-rayed ids', async () => {
    const modelBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 3, 10),
    );
    const boxes = [
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2)),
      new THREE.Box3(new THREE.Vector3(8, 0, 8), new THREE.Vector3(10, 2, 10)),
      new THREE.Box3(new THREE.Vector3(4, 0, 4), new THREE.Vector3(6, 2, 6)),
    ];
    const ctx = fakeCtx(
      new Map([['m', fakeModel({ ids: [1, 2, 3], boxes, box: modelBox })]]),
    );
    const hidden: ItemId[] = [{ modelId: 'm', localId: 1 }];
    const xrayed: ItemId[] = [{ modelId: 'm', localId: 3 }];

    const { boxes: out, framingBox } = await collectVisibleSolidBoxes(ctx, {
      hidden,
      xrayed,
      boxCache: new Map(),
    });

    // Only id 2 survives.
    expect(out).toHaveLength(1);
    expect(framingBox.min.toArray()).toEqual([8, 0, 8]);
    expect(framingBox.max.toArray()).toEqual([10, 2, 10]);
  });

  it('drops origin-anchored spatial elements whose box pokes outside model.box', async () => {
    // model.box is the tight geometry AABB far from the origin.
    const modelBox = new THREE.Box3(
      new THREE.Vector3(100, 0, 100),
      new THREE.Vector3(110, 3, 110),
    );
    const boxes = [
      // Real element, inside the geometry bounds.
      new THREE.Box3(
        new THREE.Vector3(100, 0, 100),
        new THREE.Vector3(102, 2, 102),
      ),
      // IfcSite-like element spanning from the world origin → outside model.box.
      new THREE.Box3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(110, 3, 110),
      ),
    ];
    const ctx = fakeCtx(
      new Map([['m', fakeModel({ ids: [1, 99], boxes, box: modelBox })]]),
    );

    const { boxes: out, framingBox } = await collectVisibleSolidBoxes(ctx, {
      hidden: [],
      xrayed: [],
      boxCache: new Map(),
    });

    // The spurious element is dropped; the framing box stays tight (never
    // ballooned toward the origin).
    expect(out).toHaveLength(1);
    expect(framingBox.min.toArray()).toEqual([100, 0, 100]);
    expect(framingBox.max.toArray()).toEqual([102, 2, 102]);
  });

  it('reuses a populated cache without re-querying the worker', async () => {
    const modelBox = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(4, 2, 4),
    );
    const cached: ShadowBoxCacheEntry = {
      ids: [1],
      boxes: [
        new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2)),
      ],
    };
    let queried = false;
    const ctx = fakeCtx(
      new Map([
        [
          'm',
          fakeModel({
            ids: [],
            boxes: [],
            box: modelBox,
            onGetBoxes: () => {
              queried = true;
            },
            onGetLocalIds: () => {
              queried = true;
            },
          }),
        ],
      ]),
    );
    const cache = new Map<string, ShadowBoxCacheEntry>([['m', cached]]);

    const { boxes: out } = await collectVisibleSolidBoxes(ctx, {
      hidden: [],
      xrayed: [],
      boxCache: cache,
    });

    expect(queried).toBe(false);
    expect(out).toHaveLength(1);
  });
});
