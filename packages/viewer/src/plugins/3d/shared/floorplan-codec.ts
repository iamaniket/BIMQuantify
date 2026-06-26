/**
 * Floor-plan artifact codec — decodes the processor's precomputed per-storey
 * section cut (binary format v2, stored gzip-compressed in S3). Mirror of
 * `outline-codec.ts`; the encoder lives in the processor's `pipeline/floorplans.ts`.
 *
 * Each level holds wall/structure cut segments plus IfcSpace room footprints
 * (segments + centroid label anchor), all in the model's two horizontal axes.
 * The up-axis is detected per model (see floorplans.ts) and the two horizontal
 * IFC axis indices are stored as `planAxisX` / `planAxisY` so the viewer can map
 * its camera onto the plan. Level/room *names* are NOT in this payload; they come
 * from the model metadata, joined by storey/space expressID. Decompressed layout,
 * all little-endian:
 *
 *   bytes 0-7    ASCII magic "BIMFPLN2"
 *   uint32       levelCount
 *   uint32       wallFloatsTotal
 *   uint32       roomCount
 *   uint32       roomFloatsTotal
 *   uint32       planAxisX            (IFC axis index 0/1/2 for the plan's X)
 *   uint32       planAxisY            (IFC axis index for the plan's Y)
 *   Int32Array   levelStoreyIds[levelCount]
 *   Float32Array levelElevations[levelCount]
 *   Uint32Array  levelWallFloatCounts[levelCount]   (multiple of 4)
 *   Uint32Array  levelRoomCounts[levelCount]
 *   Int32Array   roomSpaceIds[roomCount]
 *   Float32Array roomCentroids[roomCount*2]
 *   Uint32Array  roomSegFloatCounts[roomCount]      (multiple of 4)
 *   Float32Array wallSegments[wallFloatsTotal]       (x1,y1,x2,y2,… concatenated)
 *   Float32Array roomSegments[roomFloatsTotal]       (x1,y1,x2,y2,… concatenated)
 *
 * Per-level/-room slices are derived by prefix-summing the count arrays. Any
 * validation failure (or a missing native DecompressionStream) returns null so
 * the caller simply hides the 2D map. Old v1 (`BIMFPLN1`) payloads fail the magic
 * check and return null — re-extraction regenerates them.
 */

import { FLOORPLAN_MAGIC } from '@bimdossier/contracts';

/** One IfcSpace footprint: cut segments + centroid (label anchor), plan XY. */
export interface FloorPlanRoom {
  spaceId: number;
  centroid: [number, number];
  /** Cut segments [x1,y1,x2,y2,…] in plan (horizontal) coords. */
  segments: Float32Array;
}

/** One storey's plan: wall line work + room footprints. */
export interface FloorPlanLevel {
  storeyExpressID: number;
  /** Storey floor level in model units (along the detected up-axis). */
  elevation: number;
  /** Wall/structure cut segments [x1,y1,x2,y2,…] in plan coords. */
  wallSegments: Float32Array;
  rooms: FloorPlanRoom[];
}

export interface DecodedFloorPlans {
  /** IFC axis index (0=x,1=y,2=z) the plan's X / Y horizontal coords use. */
  planAxisX: number;
  planAxisY: number;
  levels: FloorPlanLevel[];
}

// Shared with the processor's encoder via @bimdossier/contracts so a one-sided
// bump can't silently break decoding here. A mismatch returns null (hides the 2D map).
const MAGIC = FLOORPLAN_MAGIC;
/** magic(8) + levelCount + wallFloatsTotal + roomCount + roomFloatsTotal + planAxisX + planAxisY. */
const HEADER_BYTES = 32;

export async function decodeFloorPlans(
  bytes: Uint8Array,
): Promise<DecodedFloorPlans | null> {
  const raw = await gunzip(bytes);
  return raw ? parseFloorPlans(raw) : null;
}

/** Native gunzip; null when unavailable or the stream is corrupt. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    void writer.write(new Uint8Array(bytes)).catch(() => undefined);
    void writer.close().catch(() => undefined);
    const buffer = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function parseFloorPlans(raw: Uint8Array): DecodedFloorPlans | null {
  if (raw.byteLength < HEADER_BYTES) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (raw[i] !== MAGIC.charCodeAt(i)) return null;
  }

  // Typed-array views need element-size-aligned byteOffsets; re-copy when the
  // slice isn't 4-byte aligned (fresh gunzip output always is).
  const data = raw.byteOffset % 4 === 0 ? raw : raw.slice();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const levelCount = view.getUint32(8, true);
  const wallFloatsTotal = view.getUint32(12, true);
  const roomCount = view.getUint32(16, true);
  const roomFloatsTotal = view.getUint32(20, true);
  const planAxisX = view.getUint32(24, true);
  const planAxisY = view.getUint32(28, true);
  const expectedBytes =
    HEADER_BYTES +
    levelCount * 16 +
    roomCount * 16 +
    wallFloatsTotal * 4 +
    roomFloatsTotal * 4;
  if (data.byteLength !== expectedBytes) return null;

  let base = data.byteOffset + HEADER_BYTES;
  const levelStoreyIds = new Int32Array(data.buffer, base, levelCount);
  base += levelCount * 4;
  const levelElevations = new Float32Array(data.buffer, base, levelCount);
  base += levelCount * 4;
  const levelWallFloatCounts = new Uint32Array(data.buffer, base, levelCount);
  base += levelCount * 4;
  const levelRoomCounts = new Uint32Array(data.buffer, base, levelCount);
  base += levelCount * 4;
  const roomSpaceIds = new Int32Array(data.buffer, base, roomCount);
  base += roomCount * 4;
  const roomCentroids = new Float32Array(data.buffer, base, roomCount * 2);
  base += roomCount * 8;
  const roomSegFloatCounts = new Uint32Array(data.buffer, base, roomCount);
  base += roomCount * 4;
  const wallSegments = new Float32Array(data.buffer, base, wallFloatsTotal);
  base += wallFloatsTotal * 4;
  const roomSegments = new Float32Array(data.buffer, base, roomFloatsTotal);

  const levels: FloorPlanLevel[] = [];
  let wOff = 0;
  let rIdx = 0;
  let rsOff = 0;
  let wallSum = 0;
  let roomSum = 0;
  for (let L = 0; L < levelCount; L++) {
    const wc = levelWallFloatCounts[L]!;
    const rc = levelRoomCounts[L]!;
    if (wc % 4 !== 0) return null;
    // .slice() detaches from the transient inflate buffer so it can be GC'd.
    const wallSeg = wallSegments.slice(wOff, wOff + wc);
    wOff += wc;
    wallSum += wc;
    const rooms: FloorPlanRoom[] = [];
    for (let r = 0; r < rc; r++) {
      const sc = roomSegFloatCounts[rIdx]!;
      if (sc % 4 !== 0) return null;
      rooms.push({
        spaceId: roomSpaceIds[rIdx]!,
        centroid: [roomCentroids[rIdx * 2]!, roomCentroids[rIdx * 2 + 1]!],
        segments: roomSegments.slice(rsOff, rsOff + sc),
      });
      rsOff += sc;
      roomSum += sc;
      rIdx++;
    }
    levels.push({
      storeyExpressID: levelStoreyIds[L]!,
      elevation: levelElevations[L]!,
      wallSegments: wallSeg,
      rooms,
    });
  }
  if (wallSum !== wallFloatsTotal || roomSum !== roomFloatsTotal) return null;

  return { planAxisX, planAxisY, levels };
}
