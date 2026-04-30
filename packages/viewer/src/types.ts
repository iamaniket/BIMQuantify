/**
 * Public types — kept here so a future xeokit-backed implementation only
 * has to honour these exact shapes.
 */

import type { Ref } from 'react';

import type { EventBus } from './core/EventBus.js';
import type { Plugin, ShortcutMap, ViewerEvents } from './core/types.js';
import type { EffectsOptions } from './plugins/effects/types.js';

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
  /** Edge length of the corner viewport in pixels. Default: 120. */
  size?: number;
};

export type BackgroundOptions = {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
};

export type ShadowOptions = {
  enabled?: boolean;
  /** 'low' = 1024px shadow map; 'medium' = 2048; 'high' = 4096 + VSM. */
  quality?: 'low' | 'medium' | 'high';
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
  viewCube?: ViewCubeOptions;
  background?: BackgroundOptions;
  shadows?: ShadowOptions;
  /** Forge-style post-processing (edges / SSAO / outline / ghost / PBR env). */
  effects?: EffectsOptions;
  ref?: Ref<ViewerHandle>;
};

export type { EffectsOptions, EffectsQuality, GhostMode } from './plugins/effects/types.js';

export type {
  Plugin,
  ViewerContext,
  ViewerEvents,
  ItemId,
  Vec3,
  ShortcutMap,
} from './core/types.js';
