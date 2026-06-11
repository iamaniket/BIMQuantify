import { gzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { decodeFloorPlans } from './floorplan-codec';

const MAGIC = 'BIMFPLN2';

interface TestRoom {
  spaceId: number;
  centroid: [number, number];
  segments: number[]; // multiple of 4
}
interface TestLevel {
  storeyExpressID: number;
  elevation: number;
  wallSegments: number[]; // multiple of 4
  rooms: TestRoom[];
}

/** Encode format v2 per the shared contract with the processor (little-endian). */
function buildRaw(
  levels: TestLevel[],
  overrides: { magic?: string; wallFloatCounts?: number[]; planAxisX?: number; planAxisY?: number } = {},
): Uint8Array {
  const magic = overrides.magic ?? MAGIC;
  const planAxisX = overrides.planAxisX ?? 0;
  const planAxisY = overrides.planAxisY ?? 2;
  const levelCount = levels.length;
  const wallFloatsTotal = levels.reduce((s, l) => s + l.wallSegments.length, 0);
  const rooms = levels.flatMap((l) => l.rooms);
  const roomCount = rooms.length;
  const roomFloatsTotal = rooms.reduce((s, r) => s + r.segments.length, 0);

  const byteLength =
    32 + levelCount * 16 + roomCount * 16 + wallFloatsTotal * 4 + roomFloatsTotal * 4;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  for (let i = 0; i < magic.length; i++) view.setUint8(i, magic.charCodeAt(i));
  view.setUint32(8, levelCount, true);
  view.setUint32(12, wallFloatsTotal, true);
  view.setUint32(16, roomCount, true);
  view.setUint32(20, roomFloatsTotal, true);
  view.setUint32(24, planAxisX, true);
  view.setUint32(28, planAxisY, true);

  let off = 32;
  for (const l of levels) { view.setInt32(off, l.storeyExpressID, true); off += 4; }
  for (const l of levels) { view.setFloat32(off, l.elevation, true); off += 4; }
  for (let i = 0; i < levelCount; i++) {
    view.setUint32(off, overrides.wallFloatCounts?.[i] ?? levels[i]!.wallSegments.length, true);
    off += 4;
  }
  for (const l of levels) { view.setUint32(off, l.rooms.length, true); off += 4; }
  for (const r of rooms) { view.setInt32(off, r.spaceId, true); off += 4; }
  for (const r of rooms) { view.setFloat32(off, r.centroid[0], true); off += 4; view.setFloat32(off, r.centroid[1], true); off += 4; }
  for (const r of rooms) { view.setUint32(off, r.segments.length, true); off += 4; }
  for (const l of levels) for (const f of l.wallSegments) { view.setFloat32(off, f, true); off += 4; }
  for (const r of rooms) for (const f of r.segments) { view.setFloat32(off, f, true); off += 4; }
  return new Uint8Array(buffer);
}

const gz = (raw: Uint8Array): Uint8Array => new Uint8Array(gzipSync(raw));

describe('decodeFloorPlans (v2)', () => {
  it('round-trips levels, rooms and plan axes', async () => {
    const levels: TestLevel[] = [
      {
        storeyExpressID: 100,
        elevation: 0,
        wallSegments: [0, 0, 4, 0, 4, 0, 4, 3],
        rooms: [{ spaceId: 200, centroid: [2, 1.5], segments: [0, 0, 4, 0] }],
      },
      { storeyExpressID: 101, elevation: 3, wallSegments: [1, 1, 2, 2], rooms: [] },
    ];
    const decoded = await decodeFloorPlans(gz(buildRaw(levels, { planAxisX: 0, planAxisY: 2 })));

    expect(decoded).not.toBeNull();
    expect(decoded!.planAxisX).toBe(0);
    expect(decoded!.planAxisY).toBe(2);
    expect(decoded!.levels).toHaveLength(2);
    const [g, l1] = decoded!.levels;
    expect(g!.storeyExpressID).toBe(100);
    expect(g!.wallSegments).toEqual(new Float32Array([0, 0, 4, 0, 4, 0, 4, 3]));
    expect(g!.rooms[0]!.spaceId).toBe(200);
    expect(g!.rooms[0]!.segments).toEqual(new Float32Array([0, 0, 4, 0]));
    expect(l1!.storeyExpressID).toBe(101);
    expect(l1!.rooms).toHaveLength(0);
  });

  it('decodes an empty artifact (zero levels)', async () => {
    const decoded = await decodeFloorPlans(gz(buildRaw([])));
    expect(decoded).not.toBeNull();
    expect(decoded!.levels).toHaveLength(0);
  });

  it('returns null on a v1 magic (old artifact)', async () => {
    const raw = buildRaw([{ storeyExpressID: 1, elevation: 0, wallSegments: [0, 0, 1, 1], rooms: [] }], {
      magic: 'BIMFPLN1',
    });
    expect(await decodeFloorPlans(gz(raw))).toBeNull();
  });

  it('returns null on a truncated buffer', async () => {
    const raw = buildRaw([{ storeyExpressID: 1, elevation: 0, wallSegments: [0, 0, 1, 1], rooms: [] }]);
    expect(await decodeFloorPlans(gz(raw.subarray(0, raw.byteLength - 4)))).toBeNull();
  });

  it('returns null on trailing bytes beyond the declared size', async () => {
    const raw = buildRaw([{ storeyExpressID: 1, elevation: 0, wallSegments: [0, 0, 1, 1], rooms: [] }]);
    const padded = new Uint8Array(raw.byteLength + 4);
    padded.set(raw);
    expect(await decodeFloorPlans(gz(padded))).toBeNull();
  });

  it('returns null when a wall float count is not a multiple of 4', async () => {
    const raw = buildRaw(
      [{ storeyExpressID: 1, elevation: 0, wallSegments: [0, 0, 1, 1], rooms: [] }],
      { wallFloatCounts: [3] },
    );
    expect(await decodeFloorPlans(gz(raw))).toBeNull();
  });

  it('returns null on a non-gzipped stream', async () => {
    const raw = buildRaw([{ storeyExpressID: 1, elevation: 0, wallSegments: [0, 0, 1, 1], rooms: [] }]);
    expect(await decodeFloorPlans(raw)).toBeNull();
  });
});
