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
import type { CameraAction, ControlsOptions } from './core/Viewer.js';
import type { EffectsOptions } from './plugins/effects/types.js';
import type { PivotRotateOptions } from './plugins/pivot-rotate/index.js';

export type ViewerBundle = {
  fragmentsUrl: string;
  metadataUrl?: string;
  propertiesUrl?: string;
};

export type ViewCubeCorner =
  | 'top-right'
  | 'top-left'
  | 'bottom-right'
  | 'bottom-left';

export type ViewCubeOptions = {
  enabled?: boolean;
  corner?: ViewCubeCorner;
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
};

export type IfcViewerProps = {
  bundle: ViewerBundle;
  className?: string;
  onReady?: (handle: ViewerHandle) => void;
  onError?: (err: Error) => void;
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
  /** Forge-style post-processing (silhouette edge lines). */
  effects?: EffectsOptions;
  /**
   * Forge-style orbit-around-cursor. Pass `false` to disable, an options
   * object to tune. Defaults are sensible — most consumers can omit this.
   */
  pivotRotate?: PivotRotateOptions | false;
  ref?: Ref<ViewerHandle>;
};

export type { EffectsOptions, EffectsQuality } from './plugins/effects/types.js';

export type { PivotRotateOptions } from './plugins/pivot-rotate/index.js';

export type { CameraAction, ControlsOptions } from './core/Viewer.js';

export type {
  Plugin,
  ViewerContext,
  ViewerEvents,
  ItemId,
  Vec3,
  ShortcutMap,
  MouseBindingMap,
} from './core/types.js';
