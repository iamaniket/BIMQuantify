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

/** A 2D finding pin (floor plan / PDF page). Mirrors the embed's `EntityMarker2D`. */
export type EmbedMarker2D = {
  id: string;
  type: 'finding' | 'certificate' | 'attachment';
  /** 1-based page; the embed shows only the visible page's pins. */
  page: number;
  /** Normalized 0..1, top-left origin, Y-down. */
  x: number;
  y: number;
  label: string;
  entityId: string;
  status?: string;
};

/** The viewer layout the native shell can request (mirrors the embed's ViewMode). */
export type ViewMode = '3d' | '2d' | 'split';

export type HostMessage =
  | {
      type: 'loadModel';
      bundle: EmbedViewerBundle;
      additionalBundles?: EmbedViewerBundle[];
      /** Initial layout. Defaults to '2d' when the bundle has floor plans, else '3d'. */
      viewMode?: ViewMode;
    }
  // PDF document (no IFC model): 2D-only viewer from server page-images.
  | { type: 'loadPdf'; pdfPagesUrl: string }
  | { type: 'setViewMode'; mode: ViewMode }
  | { type: 'syncMarkers'; markers: EmbedMarker[] }
  | { type: 'syncMarkers2D'; markers: EmbedMarker2D[] }
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
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; args: string[] }
  | {
      type: 'pinTapped';
      id: string;
      markerType: EmbedMarker['type'];
      entityId: string;
      // 3D world position; absent for a 2D pin tap.
      position?: Vec3;
    }
  | { type: 'pointPicked'; point: Vec3; item: { modelId: string; localId: number } | null }
  // 2D finding placement resolved: 1-based page + normalized 0..1 page point.
  | { type: 'findingPlaced'; page: number; x: number; y: number };

/**
 * JS that delivers a host→web message through the embed's receive global. The
 * embed JSON.parses a string argument, so we pass the message JSON as a JS
 * string literal (double-encode). The trailing `true;` avoids a noisy
 * injectJavaScript return-value warning on iOS.
 */
export function hostMessageToInjectedJs(msg: HostMessage): string {
  const payload = JSON.stringify(msg);
  return `window.__bimdossierViewerReceive && window.__bimdossierViewerReceive(${JSON.stringify(
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
