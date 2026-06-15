import type { EmbedViewerBundle } from '@/lib/api/viewerBundle';

// RN side of the postMessage bridge to apps/viewer-embed. These types mirror the
// embed's src/bridge.ts (the two packages share no code). Native sends
// HostMessages down via WebView.injectJavaScript; the embed reports ClientMessages
// up via window.ReactNativeWebView.postMessage, surfaced by WebView.onMessage.

export type Vec3 = { x: number; y: number; z: number };

/** Marker the embed renders via `entity-marker.sync` (mirrors EntityMarkerData). */
export type EmbedMarker = {
  id: string;
  type: 'finding' | 'certificate' | 'attachment';
  position: Vec3;
  modelId: string;
  label: string;
  entityId: string;
  status?: string;
  dimmed?: boolean;
};

export type HostMessage =
  | { type: 'loadModel'; bundle: EmbedViewerBundle; additionalBundles?: EmbedViewerBundle[] }
  | { type: 'syncMarkers'; markers: EmbedMarker[] }
  | { type: 'clearMarkers' }
  | { type: 'setMarkersVisible'; visible: boolean }
  | { type: 'enterPlaceMode'; oneShot?: boolean }
  | { type: 'exitPlaceMode' };

export type ClientMessage =
  | { type: 'ready' }
  | { type: 'sceneReady' }
  | { type: 'modelLoaded' }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'error'; message: string }
  | {
      type: 'pinTapped';
      id: string;
      markerType: EmbedMarker['type'];
      entityId: string;
      position: Vec3;
    }
  | { type: 'pointPicked'; point: Vec3; item: { modelId: string; localId: number } | null };

/**
 * JS that delivers a host→web message through the embed's receive global. The
 * embed JSON.parses a string argument, so we pass the message JSON as a JS
 * string literal (double-encode). The trailing `true;` avoids a noisy
 * injectJavaScript return-value warning on iOS.
 */
export function hostMessageToInjectedJs(msg: HostMessage): string {
  const payload = JSON.stringify(msg);
  return `window.__bimstitchViewerReceive && window.__bimstitchViewerReceive(${JSON.stringify(
    payload,
  )}); true;`;
}

/** Parse a WebView.onMessage payload into a ClientMessage, or null if it isn't one. */
export function parseClientMessage(data: string): ClientMessage | null {
  try {
    const obj = JSON.parse(data) as { type?: unknown };
    if (obj !== null && typeof obj === 'object' && typeof obj.type === 'string') {
      return obj as ClientMessage;
    }
  } catch {
    // Non-JSON (stray console output etc.) — ignore.
  }
  return null;
}
