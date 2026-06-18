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
import type { EffectsOptions } from './plugins/3d/effects/types.js';
import type { OutlinePluginOptions } from './plugins/3d/outline/index.js';
import type { HoverPluginOptions } from './plugins/3d/hover-highlight/index.js';
import type { InteractivePerformanceOptions } from './plugins/3d/interactive-performance/index.js';
import type { CameraFlyPluginOptions } from './plugins/3d/camera-fly/index.js';
import type { PivotRotateOptions } from './plugins/3d/pivot-rotate/index.js';
import type { SelectionPluginOptions } from './plugins/3d/selection/index.js';
import type { SectionPluginOptions } from './plugins/3d/section/index.js';
import type { SnappingPluginOptions } from './plugins/3d/snapping/index.js';

export type ViewerBundle = {
  fragmentsUrl: string;
  metadataUrl?: string;
  propertiesUrl?: string;
  /** Precomputed hard-edge outline artifact (gzipped binary, format v1). */
  outlineUrl?: string;
  cacheKey?: string;
  /**
   * Stable model id for federated loads (e.g. `file-<fileId>`). When set, the
   * viewer uses it as the FragmentsModel id so model↔file mapping is
   * deterministic. Omit for the single-file path (a timestamp id is used).
   */
  modelId?: string;
  /**
   * Precomputed floor-plan artifact (`.floorplans.bin`) for the 2D / Split
   * views. `IfcViewer` ignores it — it's consumed by the embed host
   * (apps/viewer-embed) which fetches + `decodeFloorPlans`-decodes it to drive
   * `FloorPlanViewer`. Absent when the model has no generated floor plans.
   */
  floorPlansUrl?: string;
};

export type ViewCubeOptions = {
  enabled?: boolean;
  /** Edge length of the corner viewport in pixels. Default: 160. */
  size?: number;
  /** Show the N/S/E/W compass ring under the cube. Default: true. */
  showCompass?: boolean;
  /** Show the home/reset button. Default: true. */
  showHomeButton?: boolean;
  /** Face / tooltip language. Default: 'nl'. */
  locale?: 'en' | 'nl';
};

export type BackgroundOptions = {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
  /**
   * Canvas clear-alpha, 0..1. Default 1 (opaque). Below 1 makes the WebGL
   * canvas transparent so the page background shows through (used by the
   * marketing-site 3D showcase). `scene.background` is left unset in that case.
   */
  alpha?: number;
};

export type ShadowOptions = {
  enabled?: boolean;
  /**
   * Square resolution (px) of the baked contact-shadow render target. Default
   * 1024. Lower (e.g. 512) trades a little shadow-edge softness for cheaper
   * bake + sampling on memory/fill-constrained mobile devices. Does NOT affect
   * model rendering quality.
   */
  resolution?: number;
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
  /** Last-loaded model id (single-file convenience). */
  getModelId(): string | null;
  /** Ids of every loaded model, in load order (federated viewer). */
  getModelIds(): string[];
};

export type IfcViewerProps = {
  bundle: ViewerBundle;
  /**
   * Extra models loaded into the SAME scene after `bundle` (federated
   * multi-discipline viewer). Each should carry a stable `modelId`. The
   * camera re-frames to encompass all once every model has loaded. Omit for
   * the single-file viewer.
   */
  additionalBundles?: ViewerBundle[];
  className?: string;
  onSceneReady?: () => void;
  onReady?: (handle: ViewerHandle) => void;
  onError?: (err: Error) => void;
  onProgress?: (loaded: number, total: number) => void;
  /** Extra plugins registered after built-ins. */
  plugins?: Plugin[];
  /**
   * Which built-in plugin set to register. `'full'` (default) registers every
   * built-in — the portal's complete feature set. `'minimal'` registers only
   * the snagging-essential subset (orbit + tap-select/hover + finding pins +
   * tap-to-place), for the mobile embed: it skips the install-time work and
   * per-frame event fan-out of the ~16 plugins a phone never uses. `props.plugins`
   * are still appended on top of whichever preset is chosen.
   */
  builtInPlugins?: 'full' | 'minimal';
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
  /** MSAA + FXAA composite on the idle frame. */
  effects?: EffectsOptions;
  /**
   * Geometry-based model outline drawn on the idle frame. Built once per
   * model on load and reused by x-ray. Pass `{ enabled: true }` to show it.
   */
  outline?: OutlinePluginOptions;
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
  /** First-person (fly) navigation speeds: movement, turn, mouse-look, sprint. */
  cameraFly?: CameraFlyPluginOptions;
  /** Geometry snapping (vertex, edge, midpoint). */
  snapping?: SnappingPluginOptions;
  /** Clipping/section plane support. Pass `false` to disable. */
  section?: SectionPluginOptions | false;
  /** Min/max zoom (dolly) distance limits. Auto-computed from model size when omitted. */
  zoom?: ZoomOptions;
  /**
   * EXPERIMENTAL, off by default. Fragments LOD detail tier (0–2, default 2).
   * Lowering to 1 cuts tessellation/streaming on low-end devices but can
   * visibly coarsen geometry — profile before shipping a non-default value.
   */
  graphicsQuality?: number;
  /**
   * EXPERIMENTAL, off by default. Element count above which a single model
   * starts frustum-culling under `auto` culling (default 50_000). Lower it so
   * large models cull sooner on low-end devices — profile before using.
   */
  autoCullElementThreshold?: number;
  ref?: Ref<ViewerHandle>;
};

export type { EffectsOptions, EffectsQuality } from './plugins/3d/effects/types.js';

export type { PivotRotateOptions } from './plugins/3d/pivot-rotate/index.js';

export type { CameraAction, ControlsOptions, ZoomOptions } from './core/Viewer.js';

export type { HoverPluginOptions } from './plugins/3d/hover-highlight/index.js';

export type { InteractivePerformanceOptions } from './plugins/3d/interactive-performance/index.js';

export type { SelectionPluginOptions } from './plugins/3d/selection/index.js';

export type { XrayPluginOptions } from './plugins/3d/xray/index.js';

export type { XrayPluginAPI } from './plugins/3d/xray/index.js';

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

export type { SectionPluginOptions, SectionPluginAPI, SectionPlane, SectionConfig } from './plugins/3d/section/index.js';

export type { ModePluginAPI, ModeToolDescriptor, ViewerMode } from './plugins/3d/mode/index.js';

export type { MeasurementPluginAPI, Measurement, MeasurementMode, MeasurementConfig } from './plugins/3d/measurement/index.js';


export type { SnappingPluginOptions, SnappingPluginAPI, SnapType } from './plugins/3d/snapping/index.js';

export type { WireframePluginAPI } from './plugins/3d/wireframe/index.js';

export type { ClassifierPluginAPI, ClassificationStrategy, ClassificationGroup } from './plugins/3d/classifier/index.js';

export type { ItemsFinderPluginAPI, FinderQuery, FinderOperator } from './plugins/3d/items-finder/index.js';

export type { BoundingBoxerPluginAPI, BboxDimensions } from './plugins/3d/bounding-boxer/index.js';

export type { ViewpointsPluginAPI, Viewpoint } from './plugins/3d/viewpoints/index.js';

export type { MarkerPluginAPI, MarkerPluginOptions, MarkerData } from './plugins/3d/marker/index.js';

export type { EntityMarkerPluginAPI, EntityMarkerData } from './plugins/3d/entity-marker/index.js';

export type { GridPluginAPI, GridPluginOptions } from './plugins/3d/grid/index.js';

export type { EraserPluginAPI } from './plugins/3d/eraser/index.js';

export type { PlacementPluginAPI, PlacementEnterArgs } from './plugins/3d/placement/index.js';

export type { ScreenshotPluginAPI, ScreenshotPluginOptions, ScreenshotCaptureOptions, ScreenshotResult } from './plugins/3d/screenshot/index.js';

export type { ColorCodingPluginAPI, ColorCodingOptions, ColorScheme, LegendEntry } from './plugins/3d/color-coding/index.js';

export type { ExploderPluginAPI, ExploderPluginOptions, ExplodeMode } from './plugins/3d/exploder/index.js';

export type { BcfPluginAPI, BcfViewpointData, BcfPluginOptions } from './plugins/3d/bcf/index.js';

export type {
  Plugin,
  ViewerContext,
  ViewerEvents,
  CullingMode,
  MaterialLook,
  ItemId,
  Vec3,
  ShortcutMap,
  MouseBindingMap,
} from './core/types.js';
