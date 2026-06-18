/**
 * postMessage bridge between the native RN shell and this WebView-hosted viewer.
 *
 * Native owns all state; this bundle is a stateless render-and-report surface.
 * Two transports are supported so the same build works on a device and in a
 * plain browser during development:
 *
 *   native → web : react-native-webview's `injectJavaScript` calls the global
 *                  `window.__bimstitchViewerReceive(json)`. In a browser, a
 *                  `postMessage` to this window is accepted too.
 *   web → native : `window.ReactNativeWebView.postMessage(json)`. In a browser
 *                  it falls back to `window.parent.postMessage` + a console log.
 *
 * Messages are plain JSON. Types mirror the viewer's own shapes so the native
 * side can build a `ViewerBundle` / `EntityMarkerData[]` and read back the exact
 * `{ point, item }` a `point:picked` carries.
 */

import type {
  EntityMarkerData,
  ItemId,
  Vec3,
  ViewerBundle,
} from '@bimstitch/viewer';

/** The viewer layout the host can request. */
export type ViewMode = '3d' | '2d' | 'split';

/** Messages the native shell sends down to the viewer. */
export type HostMessage =
  | {
      type: 'loadModel';
      bundle: ViewerBundle;
      additionalBundles?: ViewerBundle[];
      /** Initial layout. Defaults to '2d' when the bundle has floor plans, else '3d'. */
      viewMode?: ViewMode;
    }
  | { type: 'setViewMode'; mode: ViewMode }
  | { type: 'syncMarkers'; markers: EntityMarkerData[] }
  | { type: 'clearMarkers' }
  | { type: 'setMarkersVisible'; visible: boolean }
  | { type: 'enterPlaceMode'; oneShot?: boolean }
  | { type: 'exitPlaceMode' };

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
      position: Vec3;
    }
  | { type: 'pointPicked'; point: Vec3; item: ItemId | null };

const RECEIVE_GLOBAL = '__bimstitchViewerReceive';

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
