/**
 * Embed-safe (no-pdfjs) 2D entry point — the bare `DocumentViewer` core + the
 * full 2D plugin ecosystem + the pdfjs-free `imageRasterSource`, with NO pdf.js
 * anywhere in the import graph.
 *
 * The web/portal imports `DocumentViewer` from the main barrel ('.'), which
 * wraps this same core and injects `pdfjsRasterSource` (pulling pdf.js in — the
 * right call for the portal). The mobile embed (apps/viewer-embed) imports from
 * HERE instead, so Vite/Rollup never pull pdfjs into the react-native-webview
 * payload:
 *   - a generated floor plan renders through the `floorPlan` prop (no source);
 *   - a PDF renders through `fileUrl` (a server page-image manifest URL) +
 *     `rasterSource={imageRasterSource}` (server-pre-rendered page images).
 *
 * Same engine, same plugins, same handle as the web 2D viewer — only the page
 * raster backend differs.
 */

// Bare core (no pdfjs default). The pdfjs-defaulting wrapper lives only in the
// main barrel via `./pdfDocumentViewer`, which this entry never imports.
export { DocumentViewer } from './DocumentViewer.js';
export type {
  DocumentViewerProps,
  DocumentViewerHandle,
  DocumentLoadedInfo,
  DocumentActiveTool,
  DocumentRotation,
  DocumentSearchHit,
  SearchHighlight,
  PageDimensions,
} from './DocumentViewer.js';

// pdfjs-free page-image raster source for mobile PDFs.
export { imageRasterSource } from './pdf-core/ImageRasterSource.js';
export type {
  RasterSource,
  RasterDocument,
  RenderedPage,
  RenderPageOptions,
  RenderTextLayerOptions,
  RasterLoadProgress,
} from './pdf-core/rasterSource.js';

// Engine + plugin surface for custom pdfjs-free 2D hosts.
export { DocumentEngine } from './pdf-core/DocumentEngine.js';
export type {
  DocumentContext,
  DocumentEvents,
  DocumentPlugin,
  DocumentTool,
  SearchHighlightState,
} from './pdf-core/documentTypes.js';
export { MIN_SCALE, MAX_SCALE, clampScale } from './pdf-core/documentTypes.js';

// Floor-plan artifact decoder (BIMFPLN2) — pdfjs-free.
export { decodeFloorPlans } from './plugins/3d/shared/floorplan-codec.js';
export type {
  DecodedFloorPlans,
  FloorPlanLevel,
  FloorPlanRoom,
} from './plugins/3d/shared/floorplan-codec.js';

// 2D plugin factories (all pdfjs-free) for composing a custom plugin stack.
export { toolsPlugin } from './plugins/2d/tools/index.js';
export { scenePlugin as scenePlugin2D } from './plugins/2d/scene/index.js';
export { cameraPlugin as cameraPlugin2D } from './plugins/2d/camera/index.js';
export { pdfUnderlayPlugin } from './plugins/2d/pdf-underlay/index.js';
export { rotatePlugin } from './plugins/2d/rotate/index.js';
export { searchPlugin } from './plugins/2d/search/index.js';
export { measurePlugin } from './plugins/2d/measure/index.js';
export { markupPlugins } from './plugins/2d/markup/index.js';
export { mouseBindings2DPlugin } from './plugins/2d/mouse-bindings/index.js';
export { contextMenuPlugin as contextMenuPlugin2D } from './plugins/2d/context-menu/index.js';
export { entityMarker2DPlugin } from './plugins/2d/entity-marker/index.js';
export type {
  EntityMarker2DAPI,
  EntityMarker2DData,
  EntityMarker2DType,
} from './plugins/2d/entity-marker/index.js';
export { interaction2DPlugin } from './plugins/2d/interaction/index.js';
export { navCompassPlugin } from './plugins/2d/nav-compass/index.js';
export { floorPlanPlugin } from './plugins/2d/floorplan/index.js';
export type {
  FloorPlanPluginAPI,
  FloorPlanPluginOptions,
  FloorPlanColors,
} from './plugins/2d/floorplan/index.js';
