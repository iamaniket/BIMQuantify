/**
 * Shared internal/public types for the plugin system.
 */

import type * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';
import type { SimpleCamera } from '@thatopen/components';

import type { CommandRegistry } from './CommandRegistry.js';
import type { EventBus } from './EventBus.js';

/** Re-derived from SimpleCamera so we don't need camera-controls in deps. */
export type CameraControls = SimpleCamera['controls'];

/** Identifies a single item across all loaded models. */
export interface ItemId {
  modelId: string;
  localId: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Built-in event map. Plugins MAY emit additional events on the same bus
 * by augmenting this map via TypeScript module augmentation.
 */
export interface ViewerEvents {
  'viewer:mounted': { container: HTMLElement };
  'viewer:unmounted': undefined;
  'model:loaded': { modelId: string };
  'pointer:move': { ndc: { x: number; y: number }; clientX: number; clientY: number };
  'pointer:click': { ndc: { x: number; y: number }; button: number; shift: boolean; ctrl: boolean; meta: boolean };
  'hover:change': { item: ItemId | null };
  'selection:change': { selected: ItemId[]; added: ItemId[]; removed: ItemId[] };
  'camera:change': { position: Vec3; target: Vec3 };
  'viewer:idle': undefined;
  'command:executed': { name: string; ok: boolean; error?: string };
  'plugin:registered': { name: string };
  'plugin:unregistered': { name: string };
}

/**
 * What every plugin gets at install time. Anything a plugin needs to do
 * its job hangs off this — direct `scene`/`camera`/`renderer` access for
 * 3D plugins, plus the bus and registries for cross-plugin work.
 */
export interface ViewerContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  cameraControls: CameraControls;
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  fragments: FRAGS.FragmentsModels;
  events: EventBus<ViewerEvents>;
  commands: CommandRegistry;
  plugins: PluginRegistryView;
  /** All currently loaded models, keyed by modelId. */
  models: () => Map<string, FRAGS.FragmentsModel>;
}

export interface PluginRegistryView {
  get<T = Plugin>(name: string): T | null;
  has(name: string): boolean;
}

export interface Plugin {
  /** Unique name. Used as the key in dependency lists. */
  readonly name: string;
  readonly version?: string;
  /** Other plugin names that must be installed before this one. */
  readonly dependencies?: readonly string[];
  install(ctx: ViewerContext): void | Promise<void>;
  uninstall?(): void | Promise<void>;
}

/** Map of `keyCombo → commandName` for the keyboard-shortcuts plugin. */
export type ShortcutMap = Record<string, string>;

/** Map of `mouseGesture → commandName` for the mouse-bindings plugin. */
export type MouseBindingMap = Record<string, string>;
