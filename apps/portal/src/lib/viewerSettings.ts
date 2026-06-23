import type {
  CameraAction,
  ControlsOptions,
  CullingMode,
  DisplayMode,
  EffectsOptions,
  EffectsQuality,
  InteractivePerformanceOptions,
  MouseBindingMap,
  OutlinePluginOptions,
  ShortcutMap,
  ZoomOptions,
} from '@bimstitch/viewer';

const STORAGE_KEY = 'bimstitch.viewerSettings.v2';

export type EffectsSettings = Required<EffectsOptions>;

export type OutlineSettings = { enabled: boolean };

export type ControlsSettings = Required<ControlsOptions>;

export type InteractivePerformanceSettings = Required<InteractivePerformanceOptions>;

export type BehaviorSettings = {
  hoverHighlight: { enabled: boolean; color: number };
  selection: { enabled: boolean; color: number };
};

export type CameraFlySettings = {
  /** Fraction of the model diagonal traversed per second (movement speed). */
  moveFraction: number;
  /** Keyboard turn/pitch speed, in degrees per second (slider-friendly unit). */
  turnSpeedDeg: number;
  /** Mouse look-drag sensitivity, in radians per pixel. */
  lookSensitivity: number;
};

export type ViewerSettings = {
  viewCube: { enabled: boolean };
  shadows: { enabled: boolean };
  background: { color: number };
  effects: EffectsSettings;
  /** Build-once geometry outline drawn on the idle frame. */
  outline: OutlineSettings;
  /** command name → key combo. Matches `IfcViewerProps.shortcuts`. */
  shortcuts: ShortcutMap;
  /** Mouse gesture → command name. Matches `IfcViewerProps.mouseBindings`. */
  mouseBindings: MouseBindingMap;
  /** Drag-mouse-button assignments (rotate/pan/zoom). */
  controls: ControlsSettings;
  /** Drop expensive work while the camera is moving. */
  interactivePerformance: InteractivePerformanceSettings;
  /** Zoom behaviour: speed, max zoom-out factor, and closest-approach factor. */
  zoom: Required<ZoomOptions>;
  /** Hover-highlight & click-to-select toggles and colors. */
  behavior: BehaviorSettings;
  /** First-person (fly) navigation speeds. */
  cameraFly: CameraFlySettings;
  /** IfcSpace visibility — off by default; the toolbar toggle is the only control. */
  spaces: SpacesSettings;
  /** Scene annotation layers controlled from the side-rail count pills. */
  annotations: AnnotationSettings;
  /** Native frustum-culling policy for large/federated scenes. `auto` by default. */
  performance: PerformanceSettings;
  /** Persisted whole-model look. X-ray is session-only, so it's never stored here. */
  displayMode: DisplayModeSettings;
};

export type SpacesSettings = { show: boolean };

/**
 * Scene annotation layers whose visibility is toggled from the side-rail count
 * pills. Only finding pins persist across reloads (they re-fetch + re-sync);
 * measurements and section planes are session-only, so they're not stored here.
 */
export type AnnotationSettings = { findingPins: boolean };

export const DEFAULT_ANNOTATIONS: AnnotationSettings = { findingPins: true };

/**
 * Whole-model display look persisted across reloads. Stores only the material
 * looks (`normal` / `monochrome` / `clay` / `matcap`); x-ray is session-only
 * and never written here (selecting it persists `normal`).
 */
export type DisplayModeSettings = { mode: DisplayMode };

export const DEFAULT_DISPLAY_MODE: DisplayModeSettings = { mode: 'normal' };

export const DEFAULT_SPACES: SpacesSettings = { show: false };

/**
 * Frustum-culling policy. `auto` culls federated/large scenes only (small
 * single models stay fully visible); `on` always culls; `off` draws everything
 * (the legacy behaviour). Mirrors `CullingMode` in the viewer.
 */
export type PerformanceSettings = { culling: CullingMode };

export const DEFAULT_PERFORMANCE: PerformanceSettings = { culling: 'auto' };

export const DEFAULT_EFFECTS: EffectsSettings = {
  enabled: true,
  quality: 'medium',
};

export const DEFAULT_OUTLINE: OutlineSettings = {
  enabled: true,
};

export const DEFAULT_MOUSE_BINDINGS_SETTINGS: MouseBindingMap = {
  'click:left': 'selection.pickSet',
  'click:Shift+left': 'selection.pickAdd',
  'click:Ctrl+left': 'selection.pickToggle',
  'click:Meta+left': 'selection.pickToggle',
  'doubleclick:left': 'visibility.isolateAtPointer',
  move: 'hover.pick',
  'move:leave': 'hover.clear',
};

export const DEFAULT_ZOOM: Required<ZoomOptions> = {
  maxFactor: 4,
  toCursor: true,
  speed: 1,
  minFactor: 0.04,
};

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  hoverHighlight: { enabled: true, color: 0xffd700 },
  // Brand primary (`--primary` / light theme `primary.DEFAULT` = #2c5697) so a
  // fresh selection highlight matches the SaaS accent.
  selection: { enabled: true, color: 0x2c5697 },
};

export const DEFAULT_CAMERA_FLY: CameraFlySettings = {
  // Calmer baseline than the old 0.35 (which crossed the model in ~3s).
  moveFraction: 0.18,
  turnSpeedDeg: 70,
  lookSensitivity: 0.0025,
};

export const DEFAULT_CONTROLS: ControlsSettings = {
  // Matches camera-controls' built-in defaults, so existing users see
  // identical drag behaviour after upgrading.
  left: 'rotate',
  middle: 'dolly',
  right: 'truck',
  wheel: 'dolly',
};

// Conservative motion-suppression profile, on by default. The two enabled
// toggles are visually imperceptible — `dynamicPixelRatio` drops resolution
// only while the camera is moving (crisp again on idle) and `pauseHover` skips
// hover raycasts during motion — but together they noticeably smooth orbiting
// on large/federated models. The heavier, more visible suppressions
// (hideSmall / envelopeOnly / pixelSizeCull / flatShadeOverride) stay off; flip
// them on per-deployment for very large scenes. Every key is overridable via
// the settings dialog.
export const DEFAULT_INTERACTIVE_PERFORMANCE: InteractivePerformanceSettings = {
  hideSmall: false,
  smallPercentile: 0.5,
  envelopeOnly: false,
  envelopeCategories: [
    'IFCWALL',
    'IFCWALLSTANDARDCASE',
    'IFCSLAB',
    'IFCROOF',
    'IFCDOOR',
    'IFCWINDOW',
    'IFCCURTAINWALL',
  ],
  hideTransparent: false,
  pixelSizeCull: false,
  pixelSizeMin: 4,
  dynamicPixelRatio: true,
  motionRatio: 0.5,
  tightenFarPlane: false,
  motionFarMultiplier: 1.5,
  flatShadeOverride: false,
  pauseHover: true,
  xrayMotionHideFills: true,
};

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  viewCube: { enabled: true },
  shadows: { enabled: true },
  background: { color: 0xffffff },
  effects: DEFAULT_EFFECTS,
  outline: DEFAULT_OUTLINE,
  shortcuts: {
    'camera.home': '1',
  },
  mouseBindings: DEFAULT_MOUSE_BINDINGS_SETTINGS,
  controls: DEFAULT_CONTROLS,
  interactivePerformance: DEFAULT_INTERACTIVE_PERFORMANCE,
  zoom: DEFAULT_ZOOM,
  behavior: DEFAULT_BEHAVIOR,
  cameraFly: DEFAULT_CAMERA_FLY,
  spaces: DEFAULT_SPACES,
  annotations: DEFAULT_ANNOTATIONS,
  performance: DEFAULT_PERFORMANCE,
  displayMode: DEFAULT_DISPLAY_MODE,
};

function mergeWithDefaults(p: Partial<ViewerSettings>): ViewerSettings {
  // Clone so `?? d.x` fallbacks never hand out a live reference to the shared
  // DEFAULT_VIEWER_SETTINGS sub-objects — a later in-place mutation would
  // otherwise corrupt the module-level defaults (breaks "Reset defaults").
  const d = structuredClone(DEFAULT_VIEWER_SETTINGS);
  return {
    viewCube: p.viewCube ?? d.viewCube,
    shadows: p.shadows ?? d.shadows,
    background: p.background ?? d.background,
    effects: { ...d.effects, ...(p.effects ?? {}) },
    outline: { ...d.outline, ...(p.outline ?? {}) },
    shortcuts: { ...d.shortcuts, ...(p.shortcuts ?? {}) },
    mouseBindings: { ...d.mouseBindings, ...(p.mouseBindings ?? {}) },
    controls: { ...d.controls, ...(p.controls ?? {}) },
    interactivePerformance: {
      ...d.interactivePerformance,
      ...(p.interactivePerformance ?? {}),
    },
    zoom: { ...d.zoom, ...(p.zoom ?? {}) },
    behavior: {
      hoverHighlight: { ...d.behavior.hoverHighlight, ...(p.behavior?.hoverHighlight ?? {}) },
      selection: { ...d.behavior.selection, ...(p.behavior?.selection ?? {}) },
    },
    cameraFly: { ...d.cameraFly, ...(p.cameraFly ?? {}) },
    spaces: { ...d.spaces, ...(p.spaces ?? {}) },
    annotations: { ...d.annotations, ...(p.annotations ?? {}) },
    performance: { ...d.performance, ...(p.performance ?? {}) },
    displayMode: { ...d.displayMode, ...(p.displayMode ?? {}) },
  };
}

export function loadViewerSettings(): ViewerSettings {
  // Always return a fresh clone of the defaults — never the shared reference —
  // so consumers that store/mutate the result can't corrupt the module defaults.
  if (typeof window === 'undefined') return structuredClone(DEFAULT_VIEWER_SETTINGS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return structuredClone(DEFAULT_VIEWER_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<ViewerSettings>;
    return mergeWithDefaults(parsed);
  } catch {
    return structuredClone(DEFAULT_VIEWER_SETTINGS);
  }
}

export function saveViewerSettings(settings: ViewerSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage can throw (quota, private mode); silently ignore.
  }
}

export function colorToHex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function hexToColor(hex: string): number {
  const cleaned = hex.startsWith('#') ? hex.slice(1) : hex;
  const n = Number.parseInt(cleaned, 16);
  return Number.isFinite(n) ? n : 0xffffff;
}

export type { CameraAction, EffectsQuality };
