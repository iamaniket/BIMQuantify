import type { DocumentContext } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';

/**
 * Convert container-relative pixel coordinates to a normalized page point
 * (0..1, top-left origin, Y-down) via the scene plugin's camera. Returns null
 * before the first page render (no unscaled viewport yet).
 *
 * Shared by the `context-menu` and `document-pick` plugins so the right-click
 * anchor point and the left-click fly point use one convention — the same one
 * the entity-marker layer and the calibration picks use.
 */
export function screenToPagePoint(
  ctx: DocumentContext,
  sceneApi: SceneAPI,
  containerX: number,
  containerY: number,
): { x: number; y: number } | null {
  const unscaled = ctx.getUnscaledViewport();
  if (!unscaled) return null;
  // screenToWorld returns PDF-point world space (Y-up, origin at bottom-left).
  const world = sceneApi.screenToWorld(containerX, containerY);
  // Normalize to 0..1 with top-left origin (Y flipped); clamp to the page box.
  const nx = world.x / unscaled.width;
  const ny = 1 - world.y / unscaled.height;
  return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
}
