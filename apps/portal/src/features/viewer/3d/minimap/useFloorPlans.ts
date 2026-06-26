'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { decodeFloorPlans, accumulateBbox, emptyBbox } from '@bimdossier/viewer';

/** One IfcSpace footprint on a level (geometry only — name joined later). */
export type RawRoom = {
  spaceId: number;
  centroid: [number, number];
  segments: Float32Array;
};

/** One storey's plan geometry plus its 2D extent in IFC plan (X,Y) coords. */
export type RawLevel = {
  storeyExpressID: number;
  elevation: number;
  wallSegments: Float32Array;
  rooms: RawRoom[];
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

/** Decoded floor plans: the two horizontal IFC axes + the per-storey levels. */
export type FloorPlanData = {
  /** IFC axis index (0=x,1=y,2=z) the plan's X / Y horizontal coords use. */
  planAxisX: number;
  planAxisY: number;
  levels: RawLevel[];
};

/**
 * Flip the plan's vertical axis (every Y in an `[x1,y1,x2,y2,…]` buffer) in place.
 *
 * The footprint is authored in raw IFC horizontal axes (`planY = ifc[planAxisY]`),
 * but the viewer's 3D top-view renders that same axis the OPPOSITE way up the
 * screen — so the 2D plan reads vertically mirrored vs the 3D for every model.
 * We negate `planY` here (and the calibration applies the SAME sign flip in
 * `planCoords.ts` `viewerToPlan`/`planToViewer`) so the footprint, the "you are
 * here" marker, finding pins, and click-to-navigate all flip together and line up
 * with the 3D top view. Pure sign flip about 0 → round-trips recover the IFC value.
 */
function negateSegmentY(seg: Float32Array): void {
  for (let i = 1; i < seg.length; i += 2) seg[i] = -(seg[i] ?? 0);
}

/**
 * Fetch + decode the processor's `.floorplans.bin` artifact into per-storey
 * geometry with a precomputed 2D bbox. Names are NOT joined here (they come from
 * the model metadata, in the component) so the cache key stays the URL alone.
 */
export function useFloorPlans(floorPlansUrl: string | null): UseQueryResult<FloorPlanData> {
  return useQuery({
    queryKey: ['viewer', 'floorplans', floorPlansUrl] as const,
    enabled: floorPlansUrl !== null,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    queryFn: async (): Promise<FloorPlanData> => {
      const res = await fetch(floorPlansUrl!);
      if (!res.ok) {
        throw new Error(`Failed to fetch floor plans: ${String(res.status)}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const decoded = await decodeFloorPlans(bytes);
      if (decoded === null) return { planAxisX: 0, planAxisY: 1, levels: [] };
      const levels = decoded.levels.map((lv): RawLevel => {
        // Orient the plan to the 3D top view by flipping planY (see negateSegmentY).
        // Done BEFORE accumulating the bbox so the union/offset follow the flip.
        negateSegmentY(lv.wallSegments);
        const acc = emptyBbox();
        accumulateBbox(lv.wallSegments, acc);
        for (const r of lv.rooms) {
          negateSegmentY(r.segments);
          accumulateBbox(r.segments, acc);
        }
        return {
          storeyExpressID: lv.storeyExpressID,
          elevation: lv.elevation,
          wallSegments: lv.wallSegments,
          rooms: lv.rooms.map((r) => ({
            spaceId: r.spaceId,
            centroid: [r.centroid[0], -r.centroid[1]] as [number, number],
            segments: r.segments,
          })),
          bbox: acc,
        };
      });
      return { planAxisX: decoded.planAxisX, planAxisY: decoded.planAxisY, levels };
    },
  });
}
