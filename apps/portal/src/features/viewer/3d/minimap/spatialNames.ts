import type { SpatialNode } from '@/lib/api/viewerTypes';

/**
 * Walk the spatial tree collecting storey + space display names by expressID.
 * Shared by the canvas minimap (`MinimapView`) and the 2D floor-plan pane so
 * both label storeys/rooms identically. Names live in the model metadata, not
 * the floor-plan artifact, so they are joined by storey/space expressID.
 */
export function collectSpatialNames(
  node: SpatialNode | null,
  storeys: Map<number, string>,
  spaces: Map<number, string>,
): void {
  if (!node) return;
  if (node.type === 'IfcBuildingStorey' && node.name) storeys.set(node.expressID, node.name);
  if (node.type === 'IfcSpace' && node.name) spaces.set(node.expressID, node.name);
  for (const child of node.children) collectSpatialNames(child, storeys, spaces);
}

/** Resolve a Tailwind text-color utility to a concrete rgb() for canvas/WebGL use. */
export function resolveColor(className: string): string {
  if (typeof document === 'undefined') return '#888';
  const probe = document.createElement('span');
  probe.className = className;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || '#888';
}
