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

/** Messages the native shell sends down to the viewer. */
export type HostMessage =
  | { type: 'loadModel'; bundle: ViewerBundle; additionalBundles?: ViewerBundle[] }
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
    // eslint-disable-next-line no-console
    console.debug('[viewer-embed → host]', json);
  };

  const dispose = (): void => {
    window.removeEventListener('message', onWindowMessage);
    delete window[RECEIVE_GLOBAL];
  };

  return { send, dispose };
}
