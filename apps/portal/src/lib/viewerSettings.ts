import type {
  CameraAction,
  ControlsOptions,
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
  /** Min/max zoom distance limits (factors of model size). */
  zoom: Required<ZoomOptions>;
  /** Hover-highlight & click-to-select toggles and colors. */
  behavior: BehaviorSettings;
  /** First-person (fly) navigation speeds. */
  cameraFly: CameraFlySettings;
  /** IfcSpace visibility — off by default; the toolbar toggle is the only control. */
  spaces: SpacesSettings;
};

export type SpacesSettings = { show: boolean };

export const DEFAULT_SPACES: SpacesSettings = { show: false };

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
};

export const DEFAULT_BEHAVIOR: BehaviorSettings = {
  hoverHighlight: { enabled: true, color: 0xffd700 },
  selection: { enabled: true, color: 0x4a90d9 },
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

// Mirrors the plugin's defaults — every toggle off, sensible knob values.
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
  dynamicPixelRatio: false,
  motionRatio: 0.5,
  tightenFarPlane: false,
  motionFarMultiplier: 1.5,
  flatShadeOverride: false,
  pauseHover: false,
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
};

function mergeWithDefaults(p: Partial<ViewerSettings>): ViewerSettings {
  const d = DEFAULT_VIEWER_SETTINGS;
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
  };
}

export function loadViewerSettings(): ViewerSettings {
  if (typeof window === 'undefined') return DEFAULT_VIEWER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_VIEWER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<ViewerSettings>;
    return mergeWithDefaults(parsed);
  } catch {
    return DEFAULT_VIEWER_SETTINGS;
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
