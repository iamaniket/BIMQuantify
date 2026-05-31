/**
 * Shared internal/public types for the plugin system.
 */

import type * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';
import type { Components, SimpleCamera } from '@thatopen/components';

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
  'model:elementCount': { modelId: string; count: number };
  'pointer:move': { ndc: { x: number; y: number }; clientX: number; clientY: number };
  'pointer:click': { ndc: { x: number; y: number }; button: number; shift: boolean; ctrl: boolean; meta: boolean; clientX: number; clientY: number };
  'pointer:doubleclick': { ndc: { x: number; y: number }; button: number; shift: boolean; ctrl: boolean; meta: boolean; clientX: number; clientY: number };
  'hover:change': { item: ItemId | null };
  /**
   * Fired when the selection set changes. When `allSelected` is true the
   * full set is implicit (every loaded item) — `selected`/`added` are
   * empty by convention; consumers must consult the flag to render counts
   * and highlight state. Materializing the full list at this point would
   * cost O(N) for nothing.
   */
  'selection:change': {
    selected: ItemId[];
    added: ItemId[];
    removed: ItemId[];
    allSelected: boolean;
  };
  'camera:change': { position: Vec3; target: Vec3 };
  'viewer:idle': undefined;
  'visibility:change': { hidden: ItemId[]; isolated: ItemId[]; isolationActive: boolean };
  /**
   * Request from a viewer command (or the context menu) to open the host's
   * inspector on a specific tab for `item`. The viewer itself has no
   * inspector UI — the portal listens for this and drives its panel.
   */
  'inspect:request': { item: ItemId | null; view: 'properties' | 'attachments' | 'findings' | 'certificates' };
  'contextmenu:open': { position: { x: number; y: number }; item: ItemId | null; point: Vec3 | null };
  'contextmenu:close': undefined;
  'xray:change': { xrayed: ItemId[]; opacityOverrides: Array<{ item: ItemId; opacity: number }> };
  'outline:ready': { modelId: string };
  'outline:change': { enabled: boolean };
  'section:change': { planes: Array<{ id: string; normal: Vec3; point: Vec3; active: boolean }> };
  'section:select': { id: string | null };
  'measurement:change': { measurements: Array<{ id: string; type: string; value: number; unit: string; visible: boolean }> };
  'measurement:complete': { id: string; type: string; value: number };
  'measurement:axisLock': { active: boolean; axis: 'x' | 'y' | 'z' | null };
  'walkthrough:change': { active: boolean };
  'wireframe:change': { active: boolean };
  'snapping:change': { enabled: boolean; snap: { point: Vec3; type: string } | null };
  'classification:change': { groups: Record<string, ItemId[]> };
  'finder:results': { query: Record<string, unknown>; results: ItemId[]; count: number };
  'viewpoint:change': { viewpoints: Array<{ id: string; name: string }> };
  'marker:change': { markers: Array<{ id: string; label: string; position: Vec3 }> };
  'marker:click': { id: string; position: Vec3 };
  'grid:change': { visible: boolean };
  'eraser:change': { active: boolean };
  'navigate:change': { active: boolean };
  'screenshot:captured': { width: number; height: number };
  'colorCoding:change': { active: boolean; scheme: string | null; legend: Array<{ name: string; color: number; count: number }> };
  'exploder:change': { active: boolean; mode: string | null; factor: number };
  'command:executed': { name: string; ok: boolean; error?: string };
  'plugin:registered': { name: string };
  'plugin:unregistered': { name: string };
  'feature:enabled': { name: string; enabled: boolean };
  'mode:enter': { toolName: string; toolLabel: string };
  'mode:exit': { toolName: string };
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
  /** ThatOpen Components instance for accessing core BIM components (Classifier, etc.). */
  components: Components;
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
