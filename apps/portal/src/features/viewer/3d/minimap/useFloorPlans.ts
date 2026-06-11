'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { decodeFloorPlans, accumulateBbox, emptyBbox } from '@bimstitch/viewer';

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
        const acc = emptyBbox();
        accumulateBbox(lv.wallSegments, acc);
        for (const r of lv.rooms) accumulateBbox(r.segments, acc);
        return {
          storeyExpressID: lv.storeyExpressID,
          elevation: lv.elevation,
          wallSegments: lv.wallSegments,
          rooms: lv.rooms.map((r) => ({
            spaceId: r.spaceId,
            centroid: r.centroid,
            segments: r.segments,
          })),
          bbox: acc,
        };
      });
      return { planAxisX: decoded.planAxisX, planAxisY: decoded.planAxisY, levels };
    },
  });
}
