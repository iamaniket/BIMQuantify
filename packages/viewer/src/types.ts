/**
 * Public types — kept here so a future xeokit-backed implementation only
 * has to honour these exact shapes.
 */

import type { Ref } from 'react';

import type { EventBus } from './core/EventBus.js';
import type {
  MouseBindingMap,
  Plugin,
  ShortcutMap,
  ViewerEvents,
} from './core/types.js';
import type { CameraAction, ControlsOptions, ZoomOptions } from './core/Viewer.js';
import type { EffectsOptions } from './plugins/effects/types.js';
import type { HoverPluginOptions } from './plugins/hover-highlight/index.js';
import type { InteractivePerformanceOptions } from './plugins/interactive-performance/index.js';
import type { PivotRotateOptions } from './plugins/pivot-rotate/index.js';
import type { SelectionPluginOptions } from './plugins/selection/index.js';
import type { SectionPluginOptions } from './plugins/section/index.js';
import type { SnappingPluginOptions } from './plugins/snapping/index.js';
import type { WalkthroughPluginOptions } from './plugins/walkthrough/index.js';

export type ViewerBundle = {
  fragmentsUrl: string;
  metadataUrl?: string;
  propertiesUrl?: string;
  cacheKey?: string;
};

export type ViewCubeOptions = {
  enabled?: boolean;
  /** Edge length of the corner viewport in pixels. Default: 160. */
  size?: number;
  /** Show the N/S/E/W compass ring under the cube. Default: true. */
  showCompass?: boolean;
  /** Show the home/reset button. Default: true. */
  showHomeButton?: boolean;
};

export type BackgroundOptions = {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
};

export type ShadowOptions = {
  enabled?: boolean;
};

/**
 * Imperative handle exposed to host apps. UI in `apps/web` drives the
 * viewer through this — it never imports three.js or touches the scene.
 */
export type ViewerHandle = {
  commands: {
    execute<R = unknown>(name: string, args?: unknown): Promise<R>;
    has(name: string): boolean;
    list(): { name: string; meta: unknown }[];
  };
  events: Pick<EventBus<ViewerEvents>, 'on' | 'off' | 'once'>;
  plugins: {
    register(plugin: Plugin): Promise<void>;
    unregister(name: string): Promise<void>;
    get<T extends Plugin = Plugin>(name: string): T | null;
  };
  getModelId(): string | null;
};

export type IfcViewerProps = {
  bundle: ViewerBundle;
  className?: string;
  onSceneReady?: () => void;
  onReady?: (handle: ViewerHandle) => void;
  onError?: (err: Error) => void;
  onProgress?: (loaded: number, total: number) => void;
  /** Extra plugins registered after built-ins. */
  plugins?: Plugin[];
  /** Override default keyboard combos: `{ "camera.zoomExtents": "Space" }`. */
  shortcuts?: ShortcutMap;
  /**
   * Override default mouse gestures:
   * `{ "click:right": "selection.pickSet", "move": "hover.pick" }`.
   */
  mouseBindings?: MouseBindingMap;
  /** Drag-mouse-button assignments (rotate/pan/zoom). */
  controls?: ControlsOptions;
  viewCube?: ViewCubeOptions;
  background?: BackgroundOptions;
  shadows?: ShadowOptions;
  /** Hover highlight color and opacity. */
  hoverHighlight?: HoverPluginOptions;
  /** Selection highlight color and opacity. */
  selectionHighlight?: SelectionPluginOptions;
  /** Forge-style post-processing (silhouette edge lines). */
  effects?: EffectsOptions;
  /**
   * Forge-style orbit-around-cursor. Pass `false` to disable, an options
   * object to tune. Defaults are sensible — most consumers can omit this.
   */
  pivotRotate?: PivotRotateOptions | false;
  /**
   * Drop expensive work while the camera is moving and restore it on idle.
   * Every toggle defaults to off — opt in per setting.
   */
  interactivePerformance?: InteractivePerformanceOptions;
  /** Geometry snapping (vertex, edge, midpoint). */
  snapping?: SnappingPluginOptions;
  /** Clipping/section plane support. Pass `false` to disable. */
  section?: SectionPluginOptions | false;
  /** First-person walkthrough. Pass `false` to disable. */
  walkthrough?: WalkthroughPluginOptions | false;
  /** Min/max zoom (dolly) distance limits. Auto-computed from model size when omitted. */
  zoom?: ZoomOptions;
  ref?: Ref<ViewerHandle>;
};

export type { EffectsOptions, EffectsQuality } from './plugins/effects/types.js';

export type { PivotRotateOptions } from './plugins/pivot-rotate/index.js';

export type { CameraAction, ControlsOptions, ZoomOptions } from './core/Viewer.js';

export type { HoverPluginOptions } from './plugins/hover-highlight/index.js';

export type { InteractivePerformanceOptions } from './plugins/interactive-performance/index.js';

export type { SelectionPluginOptions } from './plugins/selection/index.js';

export type { XrayPluginOptions } from './plugins/xray/index.js';

export type { XrayPluginAPI } from './plugins/xray/index.js';

/**
 * Snapshot of all visual overrides for a single entity.
 * Composed from the separate plugin states — use `getAppearance()`
 * in the portal store to build one from the Zustand state.
 */
export interface EntityAppearance {
  selected: boolean;
  visible: boolean;
  xray: boolean;
  /** Custom opacity (0..1), or null when using the model default. */
  opacity: number | null;
}

export type { SectionPluginOptions, SectionPluginAPI, SectionPlane, SectionConfig } from './plugins/section/index.js';

export type { ModePluginAPI, ModeToolDescriptor, ViewerMode } from './plugins/mode/index.js';

export type { MeasurementPluginAPI, Measurement, MeasurementMode, MeasurementConfig } from './plugins/measurement/index.js';

export type { WalkthroughPluginOptions, WalkthroughPluginAPI } from './plugins/walkthrough/index.js';

export type { SnappingPluginOptions, SnappingPluginAPI, SnapType } from './plugins/snapping/index.js';

export type { WireframePluginAPI } from './plugins/wireframe/index.js';

export type { ClassifierPluginAPI, ClassificationStrategy, ClassificationGroup } from './plugins/classifier/index.js';

export type { ItemsFinderPluginAPI, FinderQuery, FinderOperator } from './plugins/items-finder/index.js';

export type { BoundingBoxerPluginAPI, BboxDimensions } from './plugins/bounding-boxer/index.js';

export type { ViewpointsPluginAPI, Viewpoint } from './plugins/viewpoints/index.js';

export type { BcfPluginAPI, BcfTopicSummary, BcfComment } from './plugins/bcf/index.js';

export type { MarkerPluginAPI, MarkerPluginOptions, MarkerData } from './plugins/marker/index.js';

export type { GridPluginAPI, GridPluginOptions } from './plugins/grid/index.js';

export type { EraserPluginAPI } from './plugins/eraser/index.js';

export type { ScreenshotPluginAPI, ScreenshotPluginOptions, ScreenshotCaptureOptions, ScreenshotResult } from './plugins/screenshot/index.js';

export type { ColorCodingPluginAPI, ColorCodingOptions, ColorScheme, LegendEntry } from './plugins/color-coding/index.js';

export type { ExploderPluginAPI, ExploderPluginOptions, ExplodeMode } from './plugins/exploder/index.js';

export type {
  Plugin,
  ViewerContext,
  ViewerEvents,
  ItemId,
  Vec3,
  ShortcutMap,
  MouseBindingMap,
} from './core/types.js';
