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
  WalkthroughPluginOptions,
  WalkthroughPluginAPI,
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
  BcfPluginAPI,
  BcfTopicSummary,
  BcfComment,
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
} from './types.js';

// Lower-level building blocks for users writing custom plugins.
export { EventBus } from './core/EventBus.js';
export { CommandRegistry, CommandNotFoundError } from './core/CommandRegistry.js';
export type { CommandHandler, CommandMeta } from './core/CommandRegistry.js';

// Built-in plugin factories — re-exported so consumers can disable a
// built-in (by passing `viewCube: { enabled: false }`) and re-add it
// elsewhere, or compose them with custom ones.
export { cameraPlugin } from './plugins/camera/index.js';
export { hoverHighlightPlugin } from './plugins/hover-highlight/index.js';
export { selectionPlugin } from './plugins/selection/index.js';
export { keyboardShortcutsPlugin } from './plugins/keyboard-shortcuts/index.js';
export {
  mouseBindingsPlugin,
  DEFAULT_MOUSE_BINDINGS,
} from './plugins/mouse-bindings/index.js';
export { viewCubePlugin } from './plugins/viewcube/index.js';
export { effectsPlugin } from './plugins/effects/index.js';
export { interactivePerformancePlugin } from './plugins/interactive-performance/index.js';
export { pivotRotatePlugin } from './plugins/pivot-rotate/index.js';
export { visibilityPlugin } from './plugins/visibility/index.js';
export { eraserPlugin } from './plugins/eraser/index.js';
export { contextMenuPlugin } from './plugins/context-menu/index.js';
export { xrayPlugin } from './plugins/xray/index.js';
export { sectionPlugin } from './plugins/section/index.js';
export { snappingPlugin } from './plugins/snapping/index.js';
export { modePlugin } from './plugins/mode/index.js';
export { measurementPlugin } from './plugins/measurement/index.js';
export { walkthroughPlugin } from './plugins/walkthrough/index.js';
export { wireframePlugin } from './plugins/wireframe/index.js';
export { classifierPlugin } from './plugins/classifier/index.js';
export { itemsFinderPlugin } from './plugins/items-finder/index.js';
export { boundingBoxerPlugin } from './plugins/bounding-boxer/index.js';
export { viewpointsPlugin } from './plugins/viewpoints/index.js';
export { bcfPlugin } from './plugins/bcf/index.js';
export { markerPlugin } from './plugins/marker/index.js';
export { gridPlugin } from './plugins/grid/index.js';
export { screenshotPlugin } from './plugins/screenshot/index.js';
export { colorCodingPlugin } from './plugins/color-coding/index.js';
export { exploderPlugin } from './plugins/exploder/index.js';
