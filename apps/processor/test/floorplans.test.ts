import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { IFCBUILDINGSTOREY, IFCSPACE } from 'web-ifc';

import {
  buildFloorPlans,
  type DecodedFloorPlans,
  decodeFloorPlans,
  encodeFloorPlans,
  type FloorPlanElement,
  metresPerUnit,
  resolveUpAxis,
  scanModelGeometry,
  sliceTriangleAtAxis,
} from '../src/pipeline/floorplans.js';

const IDENT16 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

const vec = <T>(items: T[]): { size: () => number; get: (i: number) => T } => ({
  size: () => items.length,
  get: (i: number) => items[i] as T,
});

type Geom = { positions: Float32Array; indices: Uint32Array };

/** A quad (two triangles) from four world corners; normals are dummy (the
 * up-axis detector uses cross-products of positions, not stored normals). */
const quad = (c0: number[], c1: number[], c2: number[], c3: number[]): Geom => ({
  positions: new Float32Array([
    ...c0, 0, 0, 0, ...c1, 0, 0, 0, ...c2, 0, 0, 0, ...c3, 0, 0, 0,
  ]),
  indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

/** Build a mocked IfcAPI from a geom registry + a list of meshes (expressID → geomId). */
const makeApi = (
  geoms: Record<number, Geom>,
  meshes: { expressID: number; geomId: number }[],
  spaceExpressIds: number[],
  storeyElevation: number | null = null,
): never =>
  ({
    GetLineIDsWithType: (_m: number, code: number) => {
      if (code === IFCBUILDINGSTOREY) return vec([1]);
      if (code === IFCSPACE) return vec(spaceExpressIds);
      return vec<number>([]);
    },
    GetLine: () => ({ Elevation: storeyElevation }),
    GetGeometry: (_m: number, geomId: number) => ({
      GetVertexData: () => geomId,
      GetVertexDataSize: () => geoms[geomId]!.positions.length,
      GetIndexData: () => geomId + 100000,
      GetIndexDataSize: () => geoms[geomId]!.indices.length,
    }),
    GetVertexArray: (ptr: number) => geoms[ptr]!.positions,
    GetIndexArray: (ptr: number) => geoms[ptr - 100000]!.indices,
    StreamAllMeshes: (_m: number, cb: (mesh: unknown) => void) => {
      for (const mh of meshes) {
        cb({
          expressID: mh.expressID,
          geometries: vec([{ geometryExpressID: mh.geomId, flatTransformation: IDENT16 }]),
        });
      }
    },
  }) as never;

/** Mocked IfcAPI with multiple storeys (per-id Elevation) + per-mesh geometry. */
const makeMultiStoreyApi = (
  geoms: Record<number, Geom>,
  meshes: { expressID: number; geomId: number }[],
  storeys: { id: number; elevation: number | null }[],
  spaceExpressIds: number[] = [],
): never =>
  ({
    GetLineIDsWithType: (_m: number, code: number) => {
      if (code === IFCBUILDINGSTOREY) return vec(storeys.map((s) => s.id));
      if (code === IFCSPACE) return vec(spaceExpressIds);
      return vec<number>([]);
    },
    GetLine: (_m: number, id: number) => ({
      Elevation: storeys.find((s) => s.id === id)?.elevation ?? null,
    }),
    GetGeometry: (_m: number, geomId: number) => ({
      GetVertexData: () => geomId,
      GetVertexDataSize: () => geoms[geomId]!.positions.length,
      GetIndexData: () => geomId + 100000,
      GetIndexDataSize: () => geoms[geomId]!.indices.length,
    }),
    GetVertexArray: (ptr: number) => geoms[ptr]!.positions,
    GetIndexArray: (ptr: number) => geoms[ptr - 100000]!.indices,
    StreamAllMeshes: (_m: number, cb: (mesh: unknown) => void) => {
      for (const mh of meshes) {
        cb({
          expressID: mh.expressID,
          geometries: vec([{ geometryExpressID: mh.geomId, flatTransformation: IDENT16 }]),
        });
      }
    },
  }) as never;

describe('metresPerUnit', () => {
  it('maps the common IFC length units', () => {
    expect(metresPerUnit('METRE')).toBe(1);
    expect(metresPerUnit('MILLIMETRE')).toBe(0.001);
    expect(metresPerUnit('CENTIMETRE')).toBe(0.01);
    expect(metresPerUnit(null)).toBe(1);
    expect(metresPerUnit('SOMETHINGWEIRD')).toBe(1);
  });
});

describe('sliceTriangleAtAxis', () => {
  it('cuts a triangle that straddles the plane (3rd/up coord)', () => {
    // Vertices (h1, h2, up): A(0,0,0) B(2,0,0) on the floor, C(0,0,3) up high.
    const seg = sliceTriangleAtAxis(0, 0, 0, 2, 0, 0, 0, 0, 3, 1.2);
    expect(seg).not.toBeNull();
    expect(seg![0]).toBeCloseTo(1.2, 5);
    expect(seg![1]).toBeCloseTo(0, 5);
    expect(seg![2]).toBeCloseTo(0, 5);
    expect(seg![3]).toBeCloseTo(0, 5);
  });

  it('returns null when entirely above or below the plane', () => {
    expect(sliceTriangleAtAxis(0, 0, 2, 1, 0, 2, 0, 1, 2.5, 1.2)).toBeNull();
    expect(sliceTriangleAtAxis(0, 0, 0, 1, 0, 0, 0, 1, 0.5, 1.2)).toBeNull();
  });
});

describe('floor-plan codec (v2)', () => {
  it('round-trips levels + plan axes', () => {
    const result: DecodedFloorPlans = {
      planAxisX: 0,
      planAxisY: 2,
      levels: [
        {
          storeyExpressID: 100,
          elevation: 0,
          wallSegments: new Float32Array([0, 0, 4, 0, 4, 0, 4, 3]),
          rooms: [{ spaceId: 200, centroid: [2, 1.5], segments: new Float32Array([0, 0, 4, 0]) }],
        },
        { storeyExpressID: 101, elevation: 3, wallSegments: new Float32Array([1, 1, 2, 2]), rooms: [] },
      ],
    };

    const decoded = decodeFloorPlans(encodeFloorPlans(result));
    expect(decoded.planAxisX).toBe(0);
    expect(decoded.planAxisY).toBe(2);
    expect(decoded.levels).toHaveLength(2);
    const g = decoded.levels[0]!;
    expect(g.storeyExpressID).toBe(100);
    expect([...g.wallSegments]).toEqual([0, 0, 4, 0, 4, 0, 4, 3]);
    expect(g.rooms[0]!.spaceId).toBe(200);
    expect([...g.rooms[0]!.segments]).toEqual([0, 0, 4, 0]);
  });

  it('round-trips an empty model', () => {
    const decoded = decodeFloorPlans(encodeFloorPlans({ planAxisX: 0, planAxisY: 1, levels: [] }));
    expect(decoded.levels).toHaveLength(0);
  });

  it('rejects a gzip stream that is not a v2 floor-plan payload', () => {
    const bogus = gzipSync(new TextEncoder().encode('BIMFPLN1 wrong magic, padded well past the 32-byte header'));
    expect(() => decodeFloorPlans(bogus)).toThrow(/FLOORPLAN_BAD_MAGIC/);
  });
});

describe('buildFloorPlans up-axis detection', () => {
  const elements: FloorPlanElement[] = [
    { expressID: 10, containedIn: 1 },
    { expressID: 11, containedIn: 1 },
    { expressID: 20, containedIn: 1 },
  ];

  it('detects Z-up (floor in XY plane) and cuts a top-down plan', () => {
    const geoms: Record<number, Geom> = {
      // Big horizontal floor at z=0 → normals along Z dominate the histogram.
      500: quad([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]),
      // Vertical wall rising z 0→3, crossing the z=1.2 cut.
      510: quad([3, 5, 0], [7, 5, 0], [7, 5, 3], [3, 5, 3]),
      // Vertical space wall (room geometry), also crossing z=1.2.
      520: quad([2, 2, 0], [8, 2, 0], [8, 2, 3], [2, 2, 3]),
    };
    const api = makeApi(
      geoms,
      [
        { expressID: 10, geomId: 500 },
        { expressID: 11, geomId: 510 },
        { expressID: 20, geomId: 520 },
      ],
      [20],
    );
    const result = buildFloorPlans(api, 0, 'METRE', elements);
    expect([result.planAxisX, result.planAxisY]).toEqual([0, 1]); // X,Y — Z is up
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]!.wallSegments.length).toBeGreaterThan(0);
    expect(result.levels[0]!.wallSegments.length % 4).toBe(0);
    expect(result.levels[0]!.rooms).toHaveLength(1);
  });

  it('detects Y-up (floor in XZ plane) and cuts a top-down plan, not an elevation', () => {
    const geoms: Record<number, Geom> = {
      // Big horizontal floor in the XZ plane at y=0 → normals along Y dominate.
      600: quad([0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]),
      // Vertical wall rising y 0→3, crossing the y=1.2 cut.
      610: quad([3, 0, 5], [7, 0, 5], [7, 3, 5], [3, 3, 5]),
      // Vertical space wall, crossing y=1.2.
      620: quad([2, 0, 2], [8, 0, 2], [8, 3, 2], [2, 3, 2]),
    };
    const api = makeApi(
      geoms,
      [
        { expressID: 10, geomId: 600 },
        { expressID: 11, geomId: 610 },
        { expressID: 20, geomId: 620 },
      ],
      [20],
    );
    const result = buildFloorPlans(api, 0, 'METRE', elements);
    expect([result.planAxisX, result.planAxisY]).toEqual([0, 2]); // X,Z — Y is up
    expect(result.levels).toHaveLength(1);
    expect(result.levels[0]!.wallSegments.length).toBeGreaterThan(0);
    expect(result.levels[0]!.wallSegments.length % 4).toBe(0);
    expect(result.levels[0]!.rooms).toHaveLength(1);
  });

  it('returns no levels when there are no storeys', () => {
    const api = ({
      GetLineIDsWithType: () => vec<number>([]),
      GetLine: () => ({}),
      StreamAllMeshes: () => undefined,
    }) as never;
    expect(buildFloorPlans(api, 0, 'METRE', []).levels).toHaveLength(0);
  });
});

describe('scanModelGeometry', () => {
  const elements: FloorPlanElement[] = [
    { expressID: 10, containedIn: 1 },
    { expressID: 11, containedIn: 1 },
  ];

  it('computes the world bbox, up-axis and cut planes in one sweep', () => {
    const geoms: Record<number, Geom> = {
      500: quad([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]), // floor at z=0
      510: quad([3, 5, 0], [7, 5, 0], [7, 5, 3], [3, 5, 3]), // wall up to z=3
    };
    const api = makeApi(
      geoms,
      [
        { expressID: 10, geomId: 500 },
        { expressID: 11, geomId: 510 },
      ],
      [],
    );
    const scan = scanModelGeometry(api, 0, 'METRE', elements);
    // bbox spans every vertex across both meshes (matches the old computeBoundingBox).
    expect(scan.bbox).not.toBeNull();
    expect([...scan.bbox!.min]).toEqual([0, 0, 0]);
    expect([...scan.bbox!.max]).toEqual([10, 10, 3]);
    // Big horizontal floor → Z is up; horizontal axes are X,Y.
    expect(scan.upAxis).toBe(2);
    expect([scan.planAxisX, scan.planAxisY]).toEqual([0, 1]);
    expect(scan.storeys).toHaveLength(1);
    expect(scan.storeys[0]!.cut).toBeCloseTo(1.2, 5); // floor (z=0) + 1.2 m
  });

  it('returns a null bbox and no storeys for an empty model', () => {
    const api = {
      GetLineIDsWithType: () => vec<number>([]),
      GetLine: () => ({}),
      StreamAllMeshes: () => undefined,
    } as never;
    const scan = scanModelGeometry(api, 0, 'METRE', []);
    expect(scan.bbox).toBeNull();
    expect(scan.storeys).toHaveLength(0);
  });
});

describe('resolveUpAxis', () => {
  const bbox = {
    min: [0, 0, 0] as [number, number, number],
    max: [30, 9, 20] as [number, number, number],
  };
  const m = (entries: [number, [number, number, number]][]) =>
    new Map<number, [number, number, number]>(entries);

  it('stacking overrides an ambiguous normal histogram (facade Y-up model)', () => {
    // Histogram screams Z (dominant facade walls), but the two storeys stack
    // along Y — their Y bands are disjoint while X/Z bands fully overlap.
    const r = resolveUpAxis(
      [1, 1, 100],
      m([
        [1, [0, 0, 0]],
        [2, [0, 3, 0]],
      ]),
      m([
        [1, [10, 3, 10]],
        [2, [10, 6, 10]],
      ]),
      new Map(),
      bbox,
    );
    expect(r).toMatchObject({ upAxis: 1, method: 'stacking' });
  });

  it('uses band overlap, not minima spread, so setbacks do not fool it', () => {
    // A 3-storey Y-up model with progressive X setbacks. Per-storey *minima
    // spread* would be largest on X (0→10) and elect X (the old bug); but the X
    // bands still overlap (upper footprints sit within the lower), while the Y
    // bands are disjoint, so the overlap metric correctly elects Y.
    const r = resolveUpAxis(
      [100, 1, 1], // histogram says X (wrong)
      m([
        [1, [0, 0, 0]],
        [2, [5, 3, 0]],
        [3, [10, 6, 0]],
      ]),
      m([
        [1, [30, 3, 20]],
        [2, [25, 6, 20]],
        [3, [20, 9, 20]],
      ]),
      new Map(),
      bbox,
    );
    expect(r).toMatchObject({ upAxis: 1, method: 'stacking' });
  });

  it('reaches consensus when stacking + elevation agree against the histogram', () => {
    // Histogram says Z (wrong), but both storey signals say Y → 2 votes win.
    const r = resolveUpAxis(
      [1, 1, 80],
      m([
        [1, [0, 0, 0]],
        [2, [0, 3, 0]],
      ]),
      m([
        [1, [10, 3, 10]],
        [2, [10, 6, 10]],
      ]),
      new Map([
        [1, 0],
        [2, 3],
      ]),
      bbox,
    );
    expect(r).toMatchObject({ upAxis: 1, method: 'consensus' });
  });

  it('all three signals agree on Z (stacked Z-up model) → consensus', () => {
    const r = resolveUpAxis(
      [1, 1, 50],
      m([
        [1, [0, 0, 0]],
        [2, [0, 0, 3]],
        [3, [0, 0, 6]],
      ]),
      m([
        [1, [10, 10, 3]],
        [2, [10, 10, 6]],
        [3, [10, 10, 9]],
      ]),
      new Map([
        [1, 0],
        [2, 3],
        [3, 6],
      ]),
      bbox,
    );
    expect(r).toMatchObject({ upAxis: 2, method: 'consensus' });
  });

  it('falls back to the normal histogram with no storey signal (default Z)', () => {
    expect(resolveUpAxis([1, 1, 5], new Map(), new Map(), new Map(), null)).toMatchObject({
      upAxis: 2,
      method: 'histogram',
    });
    expect(resolveUpAxis([9, 1, 1], new Map(), new Map(), new Map(), null)).toMatchObject({
      upAxis: 0,
      method: 'histogram',
    });
    // Degenerate / absent geometry → default Z.
    expect(resolveUpAxis([0, 0, 0], new Map(), new Map(), new Map(), null)).toMatchObject({
      upAxis: 2,
      method: 'histogram',
    });
  });
});

describe('scanModelGeometry up-axis (multi-storey)', () => {
  it('uses storey stacking to pick Y-up where wall area would fool the histogram', () => {
    // A Y-up model whose vertical facade walls (XY plane, normal ‖ Z) carry far
    // more area than the thin floors (XZ plane, normal ‖ Y), so the normal
    // histogram alone would elect Z and the plan would read as a side elevation.
    // Two storeys stacked along Y rescue the detection.
    const geoms: Record<number, Geom> = {
      // Storey 1 (y 0→3): small floor + two big facade walls.
      10: quad([0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]), // floor, normal ‖ Y
      11: quad([0, 0, 0], [10, 0, 0], [10, 3, 0], [0, 3, 0]), // wall z=0, normal ‖ Z
      12: quad([0, 0, 10], [10, 0, 10], [10, 3, 10], [0, 3, 10]), // wall z=10, normal ‖ Z
      // Storey 2 (y 3→6): the same, lifted by 3.
      20: quad([0, 3, 0], [2, 3, 0], [2, 3, 2], [0, 3, 2]),
      21: quad([0, 3, 0], [10, 3, 0], [10, 6, 0], [0, 6, 0]),
      22: quad([0, 3, 10], [10, 3, 10], [10, 6, 10], [0, 6, 10]),
    };
    const api = makeMultiStoreyApi(
      geoms,
      [
        { expressID: 110, geomId: 10 },
        { expressID: 111, geomId: 11 },
        { expressID: 112, geomId: 12 },
        { expressID: 210, geomId: 20 },
        { expressID: 211, geomId: 21 },
        { expressID: 212, geomId: 22 },
      ],
      [
        { id: 1, elevation: 0 },
        { id: 2, elevation: 3 },
      ],
    );
    const elements: FloorPlanElement[] = [
      { expressID: 110, containedIn: 1 },
      { expressID: 111, containedIn: 1 },
      { expressID: 112, containedIn: 1 },
      { expressID: 210, containedIn: 2 },
      { expressID: 211, containedIn: 2 },
      { expressID: 212, containedIn: 2 },
    ];
    const scan = scanModelGeometry(api, 0, 'METRE', elements);
    expect(scan.upAxis).toBe(1); // Y, not the histogram's Z
    expect([scan.planAxisX, scan.planAxisY]).toEqual([0, 2]);
    expect(scan.storeys).toHaveLength(2);
  });

  it('keeps a stacked Z-up model on Z (no regression)', () => {
    const geoms: Record<number, Geom> = {
      // Storey 1 (z 0→3): floor in XY (normal ‖ Z) + wall in XZ (normal ‖ Y).
      30: quad([0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]), // floor z=0
      31: quad([0, 0, 0], [10, 0, 0], [10, 0, 3], [0, 0, 3]), // wall
      // Storey 2 (z 3→6).
      40: quad([0, 0, 3], [10, 0, 3], [10, 10, 3], [0, 10, 3]),
      41: quad([0, 0, 3], [10, 0, 3], [10, 0, 6], [0, 0, 6]),
    };
    const api = makeMultiStoreyApi(
      geoms,
      [
        { expressID: 130, geomId: 30 },
        { expressID: 131, geomId: 31 },
        { expressID: 240, geomId: 40 },
        { expressID: 241, geomId: 41 },
      ],
      [
        { id: 1, elevation: 0 },
        { id: 2, elevation: 3 },
      ],
    );
    const elements: FloorPlanElement[] = [
      { expressID: 130, containedIn: 1 },
      { expressID: 131, containedIn: 1 },
      { expressID: 240, containedIn: 2 },
      { expressID: 241, containedIn: 2 },
    ];
    const scan = scanModelGeometry(api, 0, 'METRE', elements);
    expect(scan.upAxis).toBe(2);
    expect([scan.planAxisX, scan.planAxisY]).toEqual([0, 1]);
    expect(scan.storeys).toHaveLength(2);
  });
});
