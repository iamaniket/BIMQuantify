import { useEffect, useState } from 'react';

// Runtime value from the no-pdfjs entry; the type is erased so it's free from
// the barrel.
import { decodeFloorPlans } from '@bimdossier/viewer/viewer-3d';
import type { DecodedFloorPlans } from '@bimdossier/viewer';

/** One storey for the level picker (display name + isolation key). */
export type FloorPlanLevelInfo = {
  storeyExpressID: number;
  elevation: number;
  /** Display name with a "Level N" fallback when metadata has no storey name. */
  name: string;
};

/**
 * `idle` (no url) → `loading` → `ready` | `error`. A dedicated enum (rather than
 * a `loading` boolean) is what lets the host fall back to 3D ONLY after a real
 * failed attempt — a boolean races the first render, where it's still `false`
 * before the fetch effect runs, and would trip an immediate false fallback.
 */
export type FloorPlanStatus = 'idle' | 'loading' | 'ready' | 'error';

export type FloorPlanDataResult = {
  /** Decoded plan, levels sorted ASCENDING by elevation (index 0 = lowest). */
  data: DecodedFloorPlans | null;
  /** Display levels in the same order as `data.levels`. */
  levels: FloorPlanLevelInfo[];
  /** spaceId → room label, joined from the model metadata (empty when absent). */
  roomNames: Map<number, string>;
  /** storeyExpressID → element express ids on that storey (for 3D isolation). */
  storeyMembership: Map<number, number[]>;
  status: FloorPlanStatus;
};

const EMPTY: FloorPlanDataResult = {
  data: null,
  levels: [],
  roomNames: new Map(),
  storeyMembership: new Map(),
  status: 'idle',
};

/** Minimal view of the spatial tree node we need for name joins. */
type SpatialNodeLite = {
  expressID: number;
  type: string;
  name: string | null;
  children?: SpatialNodeLite[];
};

type ElementEntryLite = {
  expressID: number;
  containedIn: number | null;
};

/** Walk the spatial tree collecting storey + space display names by expressID. */
function collectNames(
  node: SpatialNodeLite | null | undefined,
  storeys: Map<number, string>,
  spaces: Map<number, string>,
): void {
  if (!node) return;
  if (node.type === 'IfcBuildingStorey' && node.name) storeys.set(node.expressID, node.name);
  if (node.type === 'IfcSpace' && node.name) spaces.set(node.expressID, node.name);
  for (const c of node.children ?? []) collectNames(c, storeys, spaces);
}

/**
 * Map each storey express id → the express ids of every element on that storey.
 * Walks the spatial tree to find IfcBuildingStorey nodes, marks every descendant
 * container, then buckets elements by their `containedIn` container. Express id
 * == fragments local id, so these feed `visibility.isolateItem` directly.
 */
function buildStoreyMembership(
  tree: SpatialNodeLite | null | undefined,
  elements: ElementEntryLite[] | undefined,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!elements || !tree) return out;
  const storeyOfContainer = new Map<number, number>();
  const mark = (node: SpatialNodeLite, storeyId: number): void => {
    storeyOfContainer.set(node.expressID, storeyId);
    for (const c of node.children ?? []) mark(c, storeyId);
  };
  const findStoreys = (node: SpatialNodeLite | null | undefined): void => {
    if (!node) return;
    if (node.type === 'IfcBuildingStorey') {
      mark(node, node.expressID);
      return;
    }
    for (const c of node.children ?? []) findStoreys(c);
  };
  findStoreys(tree);
  for (const e of elements) {
    if (e.containedIn == null) continue;
    const sid = storeyOfContainer.get(e.containedIn);
    if (sid == null) continue;
    const arr = out.get(sid);
    if (arr) arr.push(e.expressID);
    else out.set(sid, [e.expressID]);
  }
  return out;
}

/**
 * Fetch + decode the processor's `.floorplans.bin` artifact and (optionally)
 * join storey/room names from the model metadata. Levels are sorted ASCENDING
 * by elevation so index 0 is the lowest storey ("level zero"). No React Query
 * here — the embed holds no query client, so a plain effect with cancellation
 * is enough. Names are a nice-to-have: any failure falls back to "Level N".
 */
export function useFloorPlanData(
  floorPlansUrl: string | undefined,
  metadataUrl: string | undefined,
): FloorPlanDataResult {
  const [result, setResult] = useState<FloorPlanDataResult>(EMPTY);

  useEffect(() => {
    if (!floorPlansUrl) {
      setResult(EMPTY);
      return undefined;
    }

    let cancelled = false;
    setResult({ ...EMPTY, status: 'loading' });

    void (async () => {
      try {
        const res = await fetch(floorPlansUrl);
        if (!res.ok) throw new Error(`floor plans HTTP ${String(res.status)}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const decoded = await decodeFloorPlans(bytes);
        if (cancelled) return;
        if (decoded === null || decoded.levels.length === 0) {
          setResult({ ...EMPTY, status: 'error' });
          return;
        }

        const storeyNames = new Map<number, string>();
        const spaceNames = new Map<number, string>();
        let membership = new Map<number, number[]>();
        if (metadataUrl) {
          try {
            const metaRes = await fetch(metadataUrl);
            if (metaRes.ok) {
              const json = (await metaRes.json()) as {
                spatialTree?: SpatialNodeLite | null;
                elements?: ElementEntryLite[];
              };
              collectNames(json.spatialTree ?? null, storeyNames, spaceNames);
              membership = buildStoreyMembership(json.spatialTree, json.elements);
            }
          } catch {
            // Names are optional — fall back to generated "Level N".
          }
          if (cancelled) return;
        }

        // Ascending elevation: index 0 == ground == "level zero".
        const sorted = [...decoded.levels].sort((a, b) => a.elevation - b.elevation);
        const data: DecodedFloorPlans = {
          planAxisX: decoded.planAxisX,
          planAxisY: decoded.planAxisY,
          levels: sorted,
        };
        const levels = sorted.map((lv, i): FloorPlanLevelInfo => ({
          storeyExpressID: lv.storeyExpressID,
          elevation: lv.elevation,
          name: storeyNames.get(lv.storeyExpressID) ?? `Level ${String(i)}`,
        }));
        setResult({ data, levels, roomNames: spaceNames, storeyMembership: membership, status: 'ready' });
      } catch {
        if (!cancelled) setResult({ ...EMPTY, status: 'error' });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [floorPlansUrl, metadataUrl]);

  return result;
}
