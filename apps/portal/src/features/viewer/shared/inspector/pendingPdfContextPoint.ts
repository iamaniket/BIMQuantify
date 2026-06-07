/**
 * Single-use handoff for the 2D PDF context-menu click point.
 *
 * When a user right-clicks a PDF page and selects "Attach" / "Add Finding" /
 * "View Certificates" from the context menu, the normalized page coordinates
 * (0..1 from top-left) are stashed here so the inspector body can anchor the
 * new item to that exact location (`linked_file_type='pdf'` + page + {x,y}).
 *
 * This is separate from `bimstitch.pendingPdfPin` (the pin-mode flow) because
 * the pin-mode flow has its own file-picker triggering logic in the attachments
 * body. The context-menu path opens a different UI flow (auto-open dialog).
 *
 * It is read-and-removed (single use) so a stale point never leaks onto a later,
 * unrelated upload.
 */
export const PENDING_PDF_CONTEXT_POINT_KEY = 'bimstitch.pendingPdfContextPoint';

export type PendingPdfContextPoint = { page: number; x: number; y: number };

/** Stash the 2D click point for later consumption by the inspector body. */
export function stashPendingPdfContextPoint(point: PendingPdfContextPoint): void {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(PENDING_PDF_CONTEXT_POINT_KEY, JSON.stringify(point));
}

/** Read and remove the stashed 2D click point, or null if none is pending. */
export function consumePendingPdfContextPoint(): PendingPdfContextPoint | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem(PENDING_PDF_CONTEXT_POINT_KEY);
  if (raw === null) return null;
  sessionStorage.removeItem(PENDING_PDF_CONTEXT_POINT_KEY);
  try {
    const p = JSON.parse(raw) as Partial<PendingPdfContextPoint>;
    if (typeof p.page === 'number' && typeof p.x === 'number' && typeof p.y === 'number') {
      return { page: p.page, x: p.x, y: p.y };
    }
  } catch {
    // malformed — ignore
  }
  return null;
}
