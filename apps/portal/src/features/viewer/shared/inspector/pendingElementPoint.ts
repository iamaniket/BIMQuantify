/**
 * Single-use handoff for the 3D pick point.
 *
 * When a user opens an attach / finding / certificate flow from the 3D context
 * menu, the world-space point they right-clicked is stashed here so the
 * inspector body can anchor the new item to it (`linked_file_type='ifc'` +
 * `{x,y,z}`). This mirrors the PDF pin handoff (`bimstitch.pendingPdfPin`) and
 * keeps the wiring inside the portal app — no viewer-package change needed.
 *
 * It is read-and-removed (single use) so a stale point never leaks onto a later,
 * unrelated upload.
 */
export const PENDING_ELEMENT_POINT_KEY = 'bimstitch.pendingElementPoint';

export type PendingElementPoint = { x: number; y: number; z: number };

/**
 * Stash a 3D world point for later consumption by the inspector body. Used by
 * the 2D floor-plan "Add finding" flow, which converts a plan click to a 3D
 * world anchor before opening the inspector. (The 3D viewer's own context menu
 * writes the same key inline.)
 */
export function stashPendingElementPoint(point: PendingElementPoint): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(
    PENDING_ELEMENT_POINT_KEY,
    JSON.stringify({ x: point.x, y: point.y, z: point.z }),
  );
}

/** Read and remove the stashed 3D pick point, or null if none is pending. */
export function consumePendingElementPoint(): PendingElementPoint | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(PENDING_ELEMENT_POINT_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(PENDING_ELEMENT_POINT_KEY);
  try {
    const p = JSON.parse(raw) as Partial<PendingElementPoint>;
    if (typeof p.x === 'number' && typeof p.y === 'number' && typeof p.z === 'number') {
      return { x: p.x, y: p.y, z: p.z };
    }
  } catch {
    // malformed — ignore
  }
  return null;
}
