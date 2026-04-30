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
  ViewCubeCorner,
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
  PivotRotateOptions,
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
export { pivotRotatePlugin } from './plugins/pivot-rotate/index.js';
