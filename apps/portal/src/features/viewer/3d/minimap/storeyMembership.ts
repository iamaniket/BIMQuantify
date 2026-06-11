import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

/**
 * Map each storey express id → the express ids of every element on that storey.
 * Built from the extraction metadata: an element's `containedIn` is its direct
 * spatial container (often an IfcSpace), so we walk each storey's subtree to map
 * every descendant container back to the storey, then bucket elements by it.
 * Express id == fragments local id, so these feed `visibility.isolateItem`
 * directly. (The runtime classifier can't do this — the viewer loads only
 * geometry, not the IFC spatial relations.)
 *
 * Shared by `MinimapView` (overlay storey isolation) and the 2D floor-plan
 * pane's link hook (level → isolate storey in 3D).
 */
export function buildStoreyMembership(meta: ModelMetadata | undefined): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const elements = meta?.elements;
  const tree = meta?.spatialTree;
  if (!elements || !tree) return out;
  const storeyOfContainer = new Map<number, number>();
  const mark = (node: SpatialNode, storeyId: number): void => {
    storeyOfContainer.set(node.expressID, storeyId);
    for (const c of node.children) mark(c, storeyId);
  };
  const findStoreys = (node: SpatialNode | null): void => {
    if (!node) return;
    if (node.type === 'IfcBuildingStorey') {
      mark(node, node.expressID);
      return;
    }
    for (const c of node.children) findStoreys(c);
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
