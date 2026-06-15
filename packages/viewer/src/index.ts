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
export { IfcViewer } from './IfcViewer.js';
export {
  getWasmPath,
  setWasmPath,
  getWorkerUrl,
  setWorkerUrl,
} from './wasm.js';
export type {
  IfcViewerProps,
  ViewerBundle,
  ViewerHandle,
  ViewCubeOptions,
  Plugin,
  ViewerContext,
  ViewerEvents,
  ItemId,
  Vec3,
  ShortcutMap,
  MouseBindingMap,
  CameraAction,
  ControlsOptions,
  ZoomOptions,
  EffectsOptions,
  EffectsQuality,
  HoverPluginOptions,
  InteractivePerformanceOptions,
  PivotRotateOptions,
  SelectionPluginOptions,
  XrayPluginOptions,
  XrayPluginAPI,
  EntityAppearance,
  SectionPluginOptions,
  SectionPluginAPI,
  SectionPlane,
  SectionConfig,
  ModePluginAPI,
  ModeToolDescriptor,
  ViewerMode,
  MeasurementPluginAPI,
  Measurement,
  MeasurementMode,
  MeasurementConfig,
  SnappingPluginAPI,
  SnappingPluginOptions,
  SnapType,
  WireframePluginAPI,
  ClassifierPluginAPI,
  ClassificationStrategy,
  ClassificationGroup,
  ItemsFinderPluginAPI,
  FinderQuery,
  FinderOperator,
  BoundingBoxerPluginAPI,
  BboxDimensions,
  ViewpointsPluginAPI,
  Viewpoint,
  MarkerPluginAPI,
  MarkerPluginOptions,
  MarkerData,
  GridPluginAPI,
  GridPluginOptions,
  ScreenshotPluginAPI,
  ScreenshotPluginOptions,
  ScreenshotCaptureOptions,
  ScreenshotResult,
  ColorCodingPluginAPI,
  ColorCodingOptions,
  ColorScheme,
  LegendEntry,
  ExploderPluginAPI,
  ExploderPluginOptions,
  ExplodeMode,
  BcfPluginAPI,
  BcfViewpointData,
  BcfPluginOptions,
  PlacementPluginAPI,
  PlacementEnterArgs,
} from './types.js';

// Lower-level building blocks for users writing custom plugins.
export { EventBus } from './core/EventBus.js';
export { CommandRegistry, CommandNotFoundError } from './core/CommandRegistry.js';
export type { CommandHandler, CommandMeta } from './core/CommandRegistry.js';
export type { CommandSurface, MeasurementController } from './core/handle.js';
// Generic, mode-agnostic plugin core — shared by the 3D viewer and the PDF
// document engine. Custom engines build on these directly.
export { PluginManager as GenericPluginManager } from './core/plugin.js';
export type {
  Plugin as GenericPlugin,
  PluginRegistryView,
  PluginLifecycleEvents,
} from './core/plugin.js';

// PDF document engine + plugins. `DocumentViewer` (above) is the React host
// over `DocumentEngine`; these are exposed for custom PDF plugins / hosts.
export { DocumentEngine } from './pdf-core/DocumentEngine.js';
export type {
  DocumentContext,
  DocumentEvents,
  DocumentPlugin,
  DocumentTool,
  SearchHighlightState,
} from './pdf-core/documentTypes.js';
export { MIN_SCALE, MAX_SCALE, clampScale } from './pdf-core/documentTypes.js';
export { toolsPlugin } from './plugins/2d/tools/index.js';
export type { ToolsPluginAPI } from './plugins/2d/tools/index.js';
export { rotatePlugin } from './plugins/2d/rotate/index.js';
export { searchPlugin } from './plugins/2d/search/index.js';
export { measurePlugin } from './plugins/2d/measure/index.js';
export type { MeasurePluginAPI } from './plugins/2d/measure/index.js';
export type { PdfMeasureMode, PdfMeasurement } from './plugins/2d/measure/types.js';
export {
  markupPlugins,
  markupCorePlugin,
  markupRectPlugin,
  markupArrowPlugin,
  markupCloudPlugin,
  markupFreehandPlugin,
  markupTextPlugin,
  MARKUP_CORE_NAME,
} from './plugins/2d/markup/index.js';
export type {
  MarkupCoreAPI,
  MarkupToolDefinition,
  MarkupTool,
  MarkupStyle,
  Annotation2D,
  Markup2DViewState,
  MarkupDraft,
  CommittedMarkupItem,
} from './plugins/2d/markup/index.js';
export { navCompassPlugin } from './plugins/2d/nav-compass/index.js';
export type { NavCompassLocale } from './plugins/2d/nav-compass/NavCompassWidget.js';
export { scenePlugin as scenePlugin2D } from './plugins/2d/scene/index.js';
export type { SceneAPI } from './plugins/2d/scene/index.js';
export { cameraPlugin as cameraPlugin2D } from './plugins/2d/camera/index.js';
export type {
  CameraPluginAPI,
  CameraPluginOptions,
  CameraControlsConfig,
  CameraAction2D,
} from './plugins/2d/camera/index.js';
export { pdfUnderlayPlugin } from './plugins/2d/pdf-underlay/index.js';
export type { PdfUnderlayAPI } from './plugins/2d/pdf-underlay/index.js';
export { mouseBindings2DPlugin } from './plugins/2d/mouse-bindings/index.js';
export type {
  MouseBindings2DAPI,
  MouseBindings2DPluginOptions,
  MouseBindingMap2D,
} from './plugins/2d/mouse-bindings/index.js';
export { contextMenuPlugin as contextMenuPlugin2D } from './plugins/2d/context-menu/index.js';
export { entityMarker2DPlugin } from './plugins/2d/entity-marker/index.js';
export type {
  EntityMarker2DAPI,
  EntityMarker2DData,
  EntityMarker2DType,
} from './plugins/2d/entity-marker/index.js';

// Floor-plan 2D viewer — reuses the world-space 2D engine to render a decoded
// BIMFPLN2 plan (sibling to the PDF `DocumentViewer`).
export { FloorPlanViewer } from './FloorPlanViewer.js';
export type {
  FloorPlanViewerProps,
  FloorPlanViewerHandle,
  FloorPlanActiveTool,
} from './FloorPlanViewer.js';
export { FloorPlanEngine } from './floorplan-core/FloorPlanEngine.js';
export { floorPlanPlugin } from './plugins/2d/floorplan/index.js';
export type {
  FloorPlanPluginAPI,
  FloorPlanPluginOptions,
  FloorPlanColors,
} from './plugins/2d/floorplan/index.js';

// Built-in plugin factories — re-exported so consumers can disable a
// built-in (by passing `viewCube: { enabled: false }`) and re-add it
// elsewhere, or compose them with custom ones.
export { cameraPlugin } from './plugins/3d/camera/index.js';
export { hoverHighlightPlugin } from './plugins/3d/hover-highlight/index.js';
export { selectionPlugin } from './plugins/3d/selection/index.js';
export { keyboardShortcutsPlugin } from './plugins/3d/keyboard-shortcuts/index.js';
export {
  mouseBindingsPlugin,
  DEFAULT_MOUSE_BINDINGS,
} from './plugins/3d/mouse-bindings/index.js';
export { navigatePlugin } from './plugins/3d/navigate/index.js';
export { viewCubePlugin } from './plugins/3d/viewcube/index.js';
export { effectsPlugin } from './plugins/3d/effects/index.js';
export { interactivePerformancePlugin } from './plugins/3d/interactive-performance/index.js';
export { pivotRotatePlugin } from './plugins/3d/pivot-rotate/index.js';
export { visibilityPlugin } from './plugins/3d/visibility/index.js';
export { inspectPlugin } from './plugins/3d/inspect/index.js';
export { eraserPlugin } from './plugins/3d/eraser/index.js';
export { toolManagerPlugin } from './plugins/3d/tool-manager/index.js';
export type { NavMode, ActionMode, ToolManagerPluginAPI } from './plugins/3d/tool-manager/index.js';
export { contextMenuPlugin } from './plugins/3d/context-menu/index.js';
export { xrayPlugin } from './plugins/3d/xray/index.js';
export { outlinePlugin } from './plugins/3d/outline/index.js';
export type {
  OutlinePluginOptions,
  OutlinePluginAPI,
} from './plugins/3d/outline/index.js';
// Floor-plan artifact decoder (processor BIMFPLN1) — consumed by the portal
// minimap and the 2D split-view floor-plan source.
export { decodeFloorPlans } from './plugins/3d/shared/floorplan-codec.js';
export type {
  DecodedFloorPlans,
  FloorPlanLevel,
  FloorPlanRoom,
} from './plugins/3d/shared/floorplan-codec.js';
export {
  accumulateBbox,
  emptyBbox,
  isEmptyBbox,
  levelBbox,
  unionBbox,
} from './plugins/3d/shared/floorplanBbox.js';
export type { PlanBbox } from './plugins/3d/shared/floorplanBbox.js';
export { sectionPlugin } from './plugins/3d/section/index.js';
export { snappingPlugin } from './plugins/3d/snapping/index.js';
export { modePlugin } from './plugins/3d/mode/index.js';
export { measurementPlugin } from './plugins/3d/measurement/index.js';
export { cameraFlyPlugin } from './plugins/3d/camera-fly/index.js';
export type {
  CameraFlyPluginOptions,
  CameraFlyPluginAPI,
  FlyDirection,
} from './plugins/3d/camera-fly/index.js';
export { wireframePlugin } from './plugins/3d/wireframe/index.js';
export { classifierPlugin } from './plugins/3d/classifier/index.js';
export { minimapPlugin } from './plugins/3d/minimap/index.js';
export type { MinimapPluginAPI, MinimapPluginOptions } from './plugins/3d/minimap/index.js';
export { itemsFinderPlugin } from './plugins/3d/items-finder/index.js';
export { boundingBoxerPlugin } from './plugins/3d/bounding-boxer/index.js';
export { viewpointsPlugin } from './plugins/3d/viewpoints/index.js';
export { markerPlugin } from './plugins/3d/marker/index.js';
export { entityMarkerPlugin } from './plugins/3d/entity-marker/index.js';
export type { EntityMarkerData, EntityMarkerPluginAPI } from './plugins/3d/entity-marker/index.js';
export { gridPlugin } from './plugins/3d/grid/index.js';
export { screenshotPlugin } from './plugins/3d/screenshot/index.js';
export { colorCodingPlugin } from './plugins/3d/color-coding/index.js';
export { exploderPlugin } from './plugins/3d/exploder/index.js';
export { bcfPlugin } from './plugins/3d/bcf/index.js';
