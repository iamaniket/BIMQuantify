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
