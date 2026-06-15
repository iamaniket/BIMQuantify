/**
 * Shared internal/public types for the plugin system.
 */

import type * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';
import type {
  Components,
  OrthoPerspectiveCamera,
  SimpleCamera,
} from '@thatopen/components';

import type { CommandRegistry } from './CommandRegistry.js';
import type { EventBus } from './EventBus.js';
import type { Plugin as GenericPlugin, PluginRegistryView } from './plugin.js';

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
  /**
   * A single model was unloaded from a federated scene (incremental remove via
   * the dropdown). Plugins that cache per-model state (outline groups, LOD
   * material overrides, color-coding, …) MUST drop that model's entry here.
   */
  'model:unloaded': { modelId: string };
  'model:elementCount': { modelId: string; count: number };
  /**
   * Whole-model visibility toggled (federated viewer layer panel). Distinct
   * from `visibility:change`, which is element-level isolation — a model
   * hidden here stays hidden through element show-all (see `hiddenModelIds`
   * in Viewer + the outline plugin's handler).
   */
  'model:visibility': { modelId: string; visible: boolean };
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
  'inspect:request': { item: ItemId | null; view: 'properties' | 'findings' };
  'contextmenu:open': { position: { x: number; y: number }; item: ItemId | null; point: Vec3 | null };
  'contextmenu:close': undefined;
  /**
   * Placement plugin: a tap (left-click) while placement mode is active
   * raycast-hit the model. `point` is the world-space hit (store it as the new
   * anchor); `item` is the element under it, or null on an empty-space tap that
   * still resolved a point. Hosts open their new-finding/anchor flow from this.
   */
  'point:picked': { point: Vec3; item: ItemId | null };
  /** Placement plugin: the modal "drop a point" tool was entered / exited. */
  'placement:change': { active: boolean };
  'xray:change': { xrayed: ItemId[]; opacityOverrides: Array<{ item: ItemId; opacity: number }> };
  'outline:ready': { modelId: string };
  'outline:change': { enabled: boolean };
  'section:change': { planes: Array<{ id: string; normal: Vec3; point: Vec3; active: boolean }> };
  'section:select': { id: string | null };
  'measurement:change': { measurements: Array<{ id: string; type: string; value: number; unit: string; visible: boolean }> };
  'measurement:complete': { id: string; type: string; value: number };
  'measurement:axisLock': { active: boolean; axis: 'x' | 'y' | 'z' | null };
  'wireframe:change': { active: boolean };
  'snapping:change': { enabled: boolean; snap: { point: Vec3; type: string } | null };
  'classification:change': { groups: Record<string, ItemId[]> };
  'finder:results': { query: Record<string, unknown>; results: ItemId[]; count: number };
  'viewpoint:change': { viewpoints: Array<{ id: string; name: string }> };
  'marker:change': { markers: Array<{ id: string; label: string; position: Vec3 }> };
  'marker:click': { id: string; position: Vec3 };
  'entity-marker:click': { id: string; type: 'finding' | 'certificate' | 'attachment'; entityId: string; position: Vec3 };
  'grid:change': { visible: boolean };
  'eraser:change': { active: boolean };
  'navigate:change': { active: boolean };
  'navmode:change': { mode: 'orbit' | 'firstPerson' };
  'action:change': { action: 'none' | 'select' | 'erase' };
  'screenshot:captured': { width: number; height: number };
  'colorCoding:change': { active: boolean; scheme: string | null; legend: Array<{ name: string; color: number; count: number }> };
  'exploder:change': { active: boolean; mode: string | null; factor: number };
  /**
   * Minimap plugin: the live camera position + look-target projected onto the
   * floor-plan (IFC plan X/Y coords). The portal's minimap view draws the
   * "you are here" marker from this — no world-space math in the view.
   */
  'minimap:pose': { here: { x: number; y: number }; look: { x: number; y: number } };
  /** Minimap plugin: the IFC↔viewer calibration was (re)built and is usable. */
  'minimap:calibrated': { calibrated: boolean };
  /** Minimap plugin: the active level / storey isolation changed. */
  'minimap:level': { storeyName: string | null; isolated: boolean };
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
  /**
   * The ThatOpen `OrthoPerspectiveCamera` wrapper. Exposes navigation modes
   * (`set('FirstPerson')` / `set('Orbit')`) and the projection manager. Plugins
   * normally use `camera` / `cameraControls`; reach for this only to switch the
   * camera's navigation mode (e.g. the fly tool's first-person look).
   */
  obcCamera: OrthoPerspectiveCamera;
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
  /**
   * Wake the renderer for a visual change the viewer can't observe through its
   * own event bus — an animation tick, a direct scene mutation, a one-off
   * screenshot. The viewer renders on-demand (it parks in MANUAL mode when
   * idle), so a plugin that moves geometry or the camera outside a tracked
   * event MUST call this or its change won't be drawn until the next
   * interaction. Idempotent and cheap; safe to call every animation frame.
   */
  requestRender: () => void;
  /**
   * Precomputed-outline supply handed to `loadFragments` for this model, if
   * any. Resolves to the compressed artifact bytes, or null when the fetch
   * failed — consumers (outline plugin) decode it and fall back to
   * client-side edge extraction on null.
   */
  getPrecomputedOutline: (
    modelId: string,
  ) => Promise<Uint8Array | null> | undefined;
}

export type { PluginRegistryView };

/**
 * A 3D viewer plugin: the generic {@link GenericPlugin} bound to
 * {@link ViewerContext}. Existing plugins `import { Plugin } from
 * '../../core/types.js'` and keep narrowing `install(ctx: ViewerContext)`
 * with no change.
 */
export type Plugin = GenericPlugin<ViewerContext>;

/** Map of `keyCombo → commandName` for the keyboard-shortcuts plugin. */
export type ShortcutMap = Record<string, string>;

/** Map of `mouseGesture → commandName` for the mouse-bindings plugin. */
export type MouseBindingMap = Record<string, string>;
