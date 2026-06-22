import { describe, expect, it } from 'vitest';

import {
  reduceHits,
  resolvePivot,
  type PivotContext,
  type PivotHit,
} from './resolvePivot';

// Distinct points so assertions can tell candidates apart by a single axis.
const WALL = { x: 1, y: 0, z: 0 };
const STAIR = { x: 2, y: 0, z: 0 };
const CENTROID = { x: 9, y: 9, z: 9 };
const SCENE = { x: -9, y: -9, z: -9 };

const hit = (point: { x: number; y: number; z: number }, o: Partial<PivotHit> = {}): PivotHit => ({
  point,
  selected: false,
  seeThrough: false,
  clipped: false,
  ...o,
});

const ctx = (o: Partial<PivotContext> = {}): PivotContext => ({
  hasSelection: false,
  selectionCentroid: null,
  sceneCentre: null,
  ...o,
});

describe('reduceHits', () => {
  it('picks the nearest solid hit, skipping a see-through wall in front', () => {
    // The literal bug: faint (x-rayed) wall nearer than the stair.
    const hits = [hit(WALL, { seeThrough: true }), hit(STAIR)];
    const c = reduceHits(hits);
    expect(c.solidHit).toBe(STAIR);
    expect(c.anyHit).toBe(WALL); // nearest of anything is still the wall
    expect(c.selectedHit).toBeNull();
  });

  it('prefers the selected element even when a solid wall is nearer', () => {
    // Opaque wall in front, the stair behind it is the selected element.
    const hits = [hit(WALL), hit(STAIR, { selected: true })];
    const c = reduceHits(hits);
    expect(c.selectedHit).toBe(STAIR);
    expect(c.solidHit).toBe(WALL);
  });

  it('skips section-clipped hits for every candidate', () => {
    const hits = [hit(WALL, { clipped: true }), hit(STAIR)];
    const c = reduceHits(hits);
    expect(c.anyHit).toBe(STAIR);
    expect(c.solidHit).toBe(STAIR);
  });

  it('selects a hit even when it is also see-through', () => {
    const hits = [hit(STAIR, { selected: true, seeThrough: true })];
    const c = reduceHits(hits);
    expect(c.selectedHit).toBe(STAIR);
    expect(c.solidHit).toBeNull();
    expect(c.anyHit).toBe(STAIR);
  });

  it('returns all-null candidates for no hits', () => {
    expect(reduceHits([])).toEqual({ selectedHit: null, solidHit: null, anyHit: null });
  });
});

describe('resolvePivot', () => {
  it('1: orbits the selected surface under the cursor', () => {
    const c = reduceHits([hit(WALL), hit(STAIR, { selected: true })]);
    expect(resolvePivot(c, ctx({ hasSelection: true, selectionCentroid: CENTROID }))).toEqual({
      point: STAIR,
      source: 'selected-hit',
    });
  });

  it('2: orbits the selection centroid when the selection is not under the cursor', () => {
    const c = reduceHits([hit(WALL)]); // cursor over an unselected wall
    expect(resolvePivot(c, ctx({ hasSelection: true, selectionCentroid: CENTROID }))).toEqual({
      point: CENTROID,
      source: 'selection-centroid',
    });
  });

  it('3: with no selection, skips the see-through wall and orbits the stair', () => {
    const c = reduceHits([hit(WALL, { seeThrough: true }), hit(STAIR)]);
    expect(resolvePivot(c, ctx({ sceneCentre: SCENE }))).toEqual({
      point: STAIR,
      source: 'solid-hit',
    });
  });

  it('4: falls back to the nearest hit when everything is see-through', () => {
    const c = reduceHits([hit(WALL, { seeThrough: true }), hit(STAIR, { seeThrough: true })]);
    expect(resolvePivot(c, ctx({ sceneCentre: SCENE }))).toEqual({
      point: WALL,
      source: 'any-hit',
    });
  });

  it('5: falls back to the scene centre when nothing was hit', () => {
    const c = reduceHits([]);
    expect(resolvePivot(c, ctx({ sceneCentre: SCENE }))).toEqual({
      point: SCENE,
      source: 'scene-centre',
    });
  });

  it('returns null when there is nothing to orbit at all', () => {
    expect(resolvePivot(reduceHits([]), ctx())).toBeNull();
  });

  it('skips centroid rule when a selection exists but its centroid is unknown', () => {
    // hasSelection but centroid null → fall through to the solid hit.
    const c = reduceHits([hit(WALL)]);
    expect(resolvePivot(c, ctx({ hasSelection: true, selectionCentroid: null }))).toEqual({
      point: WALL,
      source: 'solid-hit',
    });
  });
});
