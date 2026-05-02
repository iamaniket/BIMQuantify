import type {
  CameraAction,
  ControlsOptions,
  EffectsOptions,
  EffectsQuality,
  InteractivePerformanceOptions,
  MouseBindingMap,
  ShortcutMap,
  ViewCubeCorner,
} from '@bimstitch/viewer';

const STORAGE_KEY = 'bimstitch.viewerSettings.v2';

export type EffectsSettings = Required<EffectsOptions>;

export type ControlsSettings = Required<ControlsOptions>;

export type InteractivePerformanceSettings = Required<InteractivePerformanceOptions>;

export type ViewerSettings = {
  viewCube: { enabled: boolean; corner: ViewCubeCorner };
  shadows: { enabled: boolean };
  background: { color: number };
  effects: EffectsSettings;
  /** command name → key combo. Matches `IfcViewerProps.shortcuts`. */
  shortcuts: ShortcutMap;
  /** Mouse gesture → command name. Matches `IfcViewerProps.mouseBindings`. */
  mouseBindings: MouseBindingMap;
  /** Drag-mouse-button assignments (rotate/pan/zoom). */
  controls: ControlsSettings;
  /** Drop expensive work while the camera is moving. */
  interactivePerformance: InteractivePerformanceSettings;
};

export const DEFAULT_EFFECTS: EffectsSettings = {
  enabled: true,
  edges: true,
  quality: 'medium',
};

export const DEFAULT_MOUSE_BINDINGS_SETTINGS: MouseBindingMap = {
  'click:left': 'selection.pickSet',
  'click:Shift+left': 'selection.pickAdd',
  'click:Ctrl+left': 'selection.pickToggle',
  'click:Meta+left': 'selection.pickToggle',
  move: 'hover.pick',
  'move:leave': 'hover.clear',
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
};

export const DEFAULT_VIEWER_SETTINGS: ViewerSettings = {
  viewCube: { enabled: true, corner: 'top-right' },
  shadows: { enabled: true },
  background: { color: 0xffffff },
  effects: DEFAULT_EFFECTS,
  shortcuts: {},
  mouseBindings: DEFAULT_MOUSE_BINDINGS_SETTINGS,
  controls: DEFAULT_CONTROLS,
  interactivePerformance: DEFAULT_INTERACTIVE_PERFORMANCE,
};

function mergeWithDefaults(p: Partial<ViewerSettings>): ViewerSettings {
  const d = DEFAULT_VIEWER_SETTINGS;
  return {
    viewCube: p.viewCube ?? d.viewCube,
    shadows: p.shadows ?? d.shadows,
    background: p.background ?? d.background,
    effects: { ...d.effects, ...(p.effects ?? {}) },
    shortcuts: p.shortcuts ?? d.shortcuts,
    mouseBindings: p.mouseBindings ?? d.mouseBindings,
    controls: { ...d.controls, ...(p.controls ?? {}) },
    interactivePerformance: {
      ...d.interactivePerformance,
      ...(p.interactivePerformance ?? {}),
    },
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
