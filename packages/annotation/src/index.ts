/**
 * `@bimdossier/annotation` — a renderer-agnostic, dependency-free image/PDF
 * annotation model plus a lightweight SVG editor for the web (portal + the
 * viewer-embed WebView). The data model converges with the 3D/PDF viewer's
 * markup (`@bimdossier/viewer` re-exports the shared types from here).
 */

// ── Model ──────────────────────────────────────────────────────────────
export type { Annotation2D, MarkupTool, MarkupStyle, AnnotationDocument } from './types.js';
export { REFERENCE_EXTENT, ANNOTATION_SCHEMA_VERSION } from './types.js';

// ── Coordinate helpers ─────────────────────────────────────────────────
export {
  clamp01,
  clientToNorm,
  normToPx,
  normPointsToPx,
  strokeWidthToPx,
  normBBox,
  annotationCentroid,
  distSqToSegment,
} from './coords.js';
export type { NormPoint, PxPoint, ImageRect } from './coords.js';

// ── History (undo/redo) ────────────────────────────────────────────────
export {
  createHistory,
  pushHistory,
  undo,
  redo,
  useAnnotationHistory,
} from './history.js';
export type { History, AnnotationHistory } from './history.js';

// ── Shapes (tool metadata + hit-testing) ───────────────────────────────
export {
  STROKE_PRESETS,
  TOOL_POINT_MODE,
  shapeMetrics,
  ShapeView,
  hitTest,
  handlePoints,
  textBoxPx,
  annotationNormBox,
} from './shapes.js';
export type { PointMode, RenderBox, ShapeMetrics } from './shapes.js';

// ── React components ────────────────────────────────────────────────────
export { AnnotationLayer } from './AnnotationLayer.js';
export type { AnnotationLayerProps } from './AnnotationLayer.js';
export { ImageAnnotator } from './ImageAnnotator.js';
export type { ImageAnnotatorProps } from './ImageAnnotator.js';
export { AnnotationToolbar, ANNOTATION_COLORS } from './AnnotationToolbar.js';
export type { AnnotationToolbarProps, AnnotationToolbarLabels, ToolbarTool } from './AnnotationToolbar.js';

// ── Export / flatten ────────────────────────────────────────────────────
export { exportAnnotatedImage, drawAnnotation } from './export.js';
export type { ExportOptions } from './export.js';
