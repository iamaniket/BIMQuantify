/**
 * postMessage bridge between the native RN shell and this WebView-hosted viewer.
 *
 * Native owns all state; this bundle is a stateless render-and-report surface.
 * Two transports are supported so the same build works on a device and in a
 * plain browser during development:
 *
 *   native → web : react-native-webview's `injectJavaScript` calls the global
 *                  `window.__bimdossierViewerReceive(json)`. In a browser, a
 *                  `postMessage` to this window is accepted too.
 *   web → native : `window.ReactNativeWebView.postMessage(json)`. In a browser
 *                  it falls back to `window.parent.postMessage` + a console log.
 *
 * Messages are plain JSON. Types mirror the viewer's own shapes so the native
 * side can build a `ViewerBundle` / `EntityMarkerData[]` and read back the exact
 * `{ point, item }` a `point:picked` carries.
 */

import { BRIDGE_RECEIVE_GLOBAL } from '@bimdossier/contracts';
import type {
  Annotation2D,
  EntityMarkerData,
  ItemId,
  Vec3,
  ViewerBundle,
} from '@bimdossier/viewer';

/** The viewer layout the host can request. */
export type ViewMode = '3d' | '2d' | 'split';

/**
 * A finding pin on the 2D viewer (floor plan / PDF page). Normalized 0..1
 * coords (top-left origin, Y-down) relative to the unrotated page box, plus the
 * 1-based `page` so the embed can show only the visible page's pins. Mirrors the
 * viewer's `EntityMarker2DData` + a `page` field.
 */
export type EntityMarker2D = {
  id: string;
  type: 'finding' | 'certificate' | 'attachment';
  page: number;
  x: number;
  y: number;
  label: string;
  entityId: string;
  status?: string;
};

/** Messages the native shell sends down to the viewer. */
export type HostMessage =
  | {
      type: 'loadModel';
      bundle: ViewerBundle;
      additionalBundles?: ViewerBundle[];
      /** Initial layout. Defaults to '2d' when the bundle has floor plans, else '3d'. */
      viewMode?: ViewMode;
    }
  // Load a PDF DOCUMENT (no IFC model): renders 2D-only from server page-images
  // (`pdfPagesUrl` = the page manifest) via the pdfjs-free image raster source.
  | { type: 'loadPdf'; pdfPagesUrl: string }
  | { type: 'setViewMode'; mode: ViewMode }
  | { type: 'syncMarkers'; markers: EntityMarkerData[] }
  // 2D finding pins (floor plan / PDF). The embed filters to the visible page.
  | { type: 'syncMarkers2D'; markers: EntityMarker2D[] }
  | { type: 'clearMarkers' }
  | { type: 'setMarkersVisible'; visible: boolean }
  | { type: 'enterPlaceMode'; oneShot?: boolean }
  | { type: 'exitPlaceMode' }
  // Image annotation (groundwork for the mobile annotator — not yet handled by
  // the embed; the native shell owns image upload, the WebView edits + reports).
  | { type: 'loadAnnotations'; imageUrl: string; annotations: Annotation2D[]; readOnly?: boolean };

/** Messages the viewer reports up to the native shell. */
export type ClientMessage =
  | { type: 'ready' }
  | { type: 'sceneReady' }
  | { type: 'modelLoaded' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'error'; message: string }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; args: string[] }
  | {
      type: 'pinTapped';
      id: string;
      markerType: EntityMarkerData['type'];
      entityId: string;
      // 3D world position; absent for a 2D pin tap (the host only needs entityId).
      position?: Vec3;
    }
  | { type: 'pointPicked'; point: Vec3; item: ItemId | null }
  // 2D finding placement resolved: 1-based page + normalized 0..1 page point.
  | { type: 'findingPlaced'; page: number; x: number; y: number }
  // Image annotation results reported back to the native shell (groundwork).
  | { type: 'annotationsChanged'; annotations: Annotation2D[] }
  | { type: 'annotationExport'; dataUrl: string };

// Shared with the native shell (apps/mobile) via @bimdossier/contracts so the
// two sides of the bridge can't drift. Aliased locally to keep the literal type.
const RECEIVE_GLOBAL = BRIDGE_RECEIVE_GLOBAL;

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(data: string): void };
    [RECEIVE_GLOBAL]?: (raw: unknown) => void;
  }
}

export interface Bridge {
  send(msg: ClientMessage): void;
  dispose(): void;
}

function isHostMessage(value: unknown): value is HostMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export function createBridge(onMessage: (msg: HostMessage) => void): Bridge {
  const handle = (raw: unknown): void => {
    let parsed: unknown = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return; // not our message
      }
    }
    if (isHostMessage(parsed)) onMessage(parsed);
  };

  // The real console.debug, captured before the wrapper below replaces it. The
  // bridge's own diagnostic line (in `send`) must use this — routing it through
  // the wrapped console would call `send` again and recurse infinitely in the
  // browser/dev path (the device path returns early before it logs, so it never
  // hit this). Without it, mounting in a plain browser floods until the stack
  // overflows — which is exactly what breaks local PC testing of the embed.
  const origDebug: (...args: unknown[]) => void = console.debug.bind(console);

  // Primary native → web channel (injectJavaScript calls this global).
  window[RECEIVE_GLOBAL] = handle;

  // Browser/iframe dev channel: a parent window can postMessage to us.
  const onWindowMessage = (ev: MessageEvent): void => {
    handle(ev.data);
  };
  window.addEventListener('message', onWindowMessage);

  const send = (msg: ClientMessage): void => {
    const json = JSON.stringify(msg);
    const rn = window.ReactNativeWebView;
    if (rn && typeof rn.postMessage === 'function') {
      rn.postMessage(json);
      return;
    }
    // Dev fallbacks — no native host present.
    if (window.parent !== window) {
      window.parent.postMessage(msg, '*');
    }
    origDebug('[viewer-embed → host]', json);
  };

  // Forward console.* to the native shell so logs are visible in Metro/Logcat.
  const LOG_LEVELS = ['debug', 'log', 'info', 'warn', 'error'] as const;
  const origConsole: Record<string, (...a: unknown[]) => void> = {};
  for (const level of LOG_LEVELS) {
    const original = console[level];
    origConsole[level] = original;
    console[level] = (...args: unknown[]) => {
      original(...args);
      const mapped: ClientMessage & { type: 'log' } = {
        type: 'log',
        level: level === 'log' ? 'info' : level,
        args: args.map(String),
      };
      send(mapped);
    };
  }

  const dispose = (): void => {
    window.removeEventListener('message', onWindowMessage);
    delete window[RECEIVE_GLOBAL];
    for (const level of LOG_LEVELS) {
      const original = origConsole[level];
      if (original) console[level] = original;
    }
  };

  return { send, dispose };
}
