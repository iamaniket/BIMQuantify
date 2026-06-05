/**
 * The two axes of the viewer.
 *
 * `ViewerKind` is the coarse 2D-vs-3D split that drives the chrome — which
 * toolbar, which settings-dialog mode, which side rail + panels. `ViewerFormat`
 * is the concrete file format that drives which canvas/renderer mounts and the
 * format-specific bodies (drawing info, PDF pins, …).
 *
 * Adding a new 2D format is "add a `ViewerFormat` value + a canvas branch", NOT
 * "add a new kind" — the 2D viewer is a general container, PDF/DXF/DWG are just
 * the formats it hosts today.
 */
export type ViewerKind = '2d' | '3d';

export type ViewerFormat = 'ifc' | 'pdf' | 'dxf' | 'dwg';

/** IFC is the only 3D format today; every other format renders in the 2D viewer. */
export function kindForFormat(format: ViewerFormat): ViewerKind {
  return format === 'ifc' ? '3d' : '2d';
}

/** DXF and DWG share the vector "drawing" renderer + info panel. */
export function isDrawingFormat(format: ViewerFormat): boolean {
  return format === 'dxf' || format === 'dwg';
}
