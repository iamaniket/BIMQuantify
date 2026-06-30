import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import type { ViewerContext } from './types';
import { pick, pickAll } from './Raycaster';

/**
 * The multi-model picker dispatches every model's worker raycast concurrently
 * (Promise.all) instead of awaiting each in turn. These tests pin the contract
 * that the parallel dispatch is behavior-identical to the old serial loop:
 * `pick` returns the single nearest hit across all models, `pickAll` returns the
 * union sorted near→far, and one model's raycast throwing must not abort the
 * others (per-model fault isolation).
 *
 * No GPU: each fake model's `raycast`/`raycastAll` returns canned results.
 */

interface Hit {
  localId: number;
  point: THREE.Vector3;
  distance: number;
}

function fakeModel(hit: Hit | Hit[] | null, opts?: { throws?: boolean }) {
  const list = hit === null ? [] : Array.isArray(hit) ? hit : [hit];
  return {
    raycast: vi.fn(() =>
      opts?.throws
        ? Promise.reject(new Error('boom'))
        : Promise.resolve(list[0] ?? null),
    ),
    raycastAll: vi.fn(() =>
      opts?.throws ? Promise.reject(new Error('boom')) : Promise.resolve(list),
    ),
  };
}

function makeCtx(models: Map<string, ReturnType<typeof fakeModel>>): ViewerContext {
  return {
    camera: {},
    canvas: {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    },
    models: () => models,
  } as unknown as ViewerContext;
}

const NDC = { x: 0, y: 0 };

describe('Raycaster.pick — concurrent multi-model dispatch', () => {
  it('returns the nearest hit across all models, with the correct modelId', async () => {
    const models = new Map([
      ['file-far', fakeModel({ localId: 1, point: new THREE.Vector3(0, 0, 9), distance: 9 })],
      ['file-near', fakeModel({ localId: 2, point: new THREE.Vector3(0, 0, 2), distance: 2 })],
      ['file-mid', fakeModel({ localId: 3, point: new THREE.Vector3(0, 0, 5), distance: 5 })],
    ]);
    const result = await pick(makeCtx(models), NDC);

    expect(result).not.toBeNull();
    expect(result!.distance).toBe(2);
    expect(result!.item).toEqual({ modelId: 'file-near', localId: 2 });
  });

  it('isolates a throwing model — still returns the nearest surviving hit', async () => {
    const models = new Map([
      ['file-bad', fakeModel({ localId: 1, point: new THREE.Vector3(0, 0, 1), distance: 1 }, { throws: true })],
      ['file-good', fakeModel({ localId: 2, point: new THREE.Vector3(0, 0, 4), distance: 4 })],
    ]);
    const result = await pick(makeCtx(models), NDC);

    expect(result!.item).toEqual({ modelId: 'file-good', localId: 2 });
    expect(result!.distance).toBe(4);
  });

  it('returns null when no model hits', async () => {
    const models = new Map([
      ['file-a', fakeModel(null)],
      ['file-b', fakeModel(null)],
    ]);
    expect(await pick(makeCtx(models), NDC)).toBeNull();
  });
});

describe('Raycaster.pickAll — concurrent multi-model dispatch', () => {
  it('returns the union of all hits sorted near→far', async () => {
    const models = new Map([
      ['file-a', fakeModel([
        { localId: 1, point: new THREE.Vector3(0, 0, 6), distance: 6 },
        { localId: 2, point: new THREE.Vector3(0, 0, 1), distance: 1 },
      ])],
      ['file-b', fakeModel([
        { localId: 3, point: new THREE.Vector3(0, 0, 3), distance: 3 },
      ])],
    ]);
    const hits = await pickAll(makeCtx(models), NDC);

    expect(hits.map((h) => h.distance)).toEqual([1, 3, 6]);
    expect(hits.map((h) => h.item.modelId)).toEqual(['file-a', 'file-b', 'file-a']);
  });

  it('isolates a throwing model in pickAll', async () => {
    const models = new Map([
      ['file-bad', fakeModel([{ localId: 1, point: new THREE.Vector3(), distance: 1 }], { throws: true })],
      ['file-good', fakeModel([{ localId: 2, point: new THREE.Vector3(0, 0, 2), distance: 2 }])],
    ]);
    const hits = await pickAll(makeCtx(models), NDC);

    expect(hits).toHaveLength(1);
    expect(hits[0]!.item).toEqual({ modelId: 'file-good', localId: 2 });
  });
});
