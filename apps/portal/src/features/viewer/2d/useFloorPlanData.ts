'use client';

import { useMemo } from 'react';

import type { DecodedFloorPlans } from '@bimstitch/viewer';

import { collectSpatialNames } from '@/features/viewer/3d/minimap/spatialNames';
import { useFloorPlans } from '@/features/viewer/3d/minimap/useFloorPlans';
import type { ModelMetadata } from '@/lib/api/viewerTypes';

/** One storey for the level dropdown (display name + isolation key). */
export type FloorPlanDisplayLevel = {
  storeyExpressID: number;
  elevation: number;
  /** Display name with a "Level N" fallback. */
  name: string;
  /** Real IfcBuildingStorey name (null when unnamed) — kept for isolation labels. */
  storeyName: string | null;
};

export type FloorPlanDataResult = {
  /** Decoded plan, levels sorted top→bottom (descending elevation). */
  data: DecodedFloorPlans | null;
  /** Display levels in the same order as `data.levels`. */
  levels: FloorPlanDisplayLevel[];
  /** spaceId → room label, joined from the model metadata. */
  roomNames: Map<number, string>;
  planAxisX: number;
  planAxisY: number;
};

/**
 * Fetch + decode the floor-plan artifact and join storey/room names from the
 * model metadata, returning a SORTED `DecodedFloorPlans` whose level order
 * matches the dropdown (so `activeLevel` indexes both identically). Reuses
 * `useFloorPlans` for the fetch/decode/bbox; this hook only adds the name join
 * and the stable ordering the 2D engine needs.
 */
export function useFloorPlanData(
  floorPlansUrl: string | null,
  metadata: ModelMetadata | undefined,
  levelNameFallback: (n: number) => string,
): FloorPlanDataResult {
  const { data: fp } = useFloorPlans(floorPlansUrl);

  return useMemo<FloorPlanDataResult>(() => {
    const empty: FloorPlanDataResult = {
      data: null,
      levels: [],
      roomNames: new Map(),
      planAxisX: 0,
      planAxisY: 1,
    };
    if (!fp || fp.levels.length === 0) return empty;

    const storeyNames = new Map<number, string>();
    const spaceNames = new Map<number, string>();
    collectSpatialNames(metadata?.spatialTree ?? null, storeyNames, spaceNames);

    // Sort top→bottom so the level index is consistent across the dropdown,
    // the engine page, and the floor-plan plugin.
    const sorted = [...fp.levels].sort((a, b) => b.elevation - a.elevation);

    const levels = sorted.map((lv, i): FloorPlanDisplayLevel => {
      const storeyName = storeyNames.get(lv.storeyExpressID) ?? null;
      return {
        storeyExpressID: lv.storeyExpressID,
        elevation: lv.elevation,
        name: storeyName ?? levelNameFallback(i + 1),
        storeyName,
      };
    });

    const data: DecodedFloorPlans = {
      planAxisX: fp.planAxisX,
      planAxisY: fp.planAxisY,
      levels: sorted.map((lv) => ({
        storeyExpressID: lv.storeyExpressID,
        elevation: lv.elevation,
        wallSegments: lv.wallSegments,
        rooms: lv.rooms.map((r) => ({ spaceId: r.spaceId, centroid: r.centroid, segments: r.segments })),
      })),
    };

    return { data, levels, roomNames: spaceNames, planAxisX: fp.planAxisX, planAxisY: fp.planAxisY };
  }, [fp, metadata, levelNameFallback]);
}
