import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

// 3D entry kept imported but dormant in v1 (see ENABLE_3D). Types from the barrel
// are erased at build time, so importing them there is free.
import { IfcViewer } from '@bimdossier/viewer/viewer-3d';
import type { ViewerBundle } from '@bimdossier/viewer';

import { createBridge, type Bridge, type EntityMarker2D, type HostMessage, type ViewMode } from './bridge';
import { FloorPlanPane } from './FloorPlanPane';
import { useFloorPlanData } from './useFloorPlanData';

/**
 * The embed renders the unified 2D `DocumentViewer` (floor plans + PDFs) and,
 * when built 3D-capable AND the host requests a 3D layout, the `IfcViewer` 3D
 * pane. 3D is gated at TWO layers:
 *   1. BUILD: `ENABLE_3D` (below) is the compile-time `VITE_ENABLE_3D` flag — a
 *      hard kill-switch. When off the `IfcViewer` branch is statically dead, so a
 *      v1 build can NEVER mount 3D no matter what the native shell sends. (The 2D
 *      floor-plan viewer is itself three/web-ifc-based, so those deps ship either
 *      way — this is a safety gate, not a bundle-size lever.)
 *   2. RUNTIME: the native shell only requests `viewMode: '3d'` when its own
 *      `EXPO_PUBLIC_ENABLE_3D_VIEWER` flag is on, so a 3D-capable bundle still
 *      renders 2D-only until the user opts in.
 *
 * Native owns all state; this bundle is a stateless render-and-report surface
 * driven over the postMessage bridge.
 */
const ENABLE_3D = import.meta.env.VITE_ENABLE_3D === 'true';

const EMPTY_MARKERS: EntityMarker2D[] = [];

export function App() {
  // IFC model bundle (its floor plan is the 2D source). Mutually exclusive with pdfDocUrl.
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  // PDF document: the page-image manifest URL (2D-only, no IFC model).
  const [pdfDocUrl, setPdfDocUrl] = useState<string | null>(null);
  const [markers, setMarkers] = useState<EntityMarker2D[]>(EMPTY_MARKERS);
  // The layout the host requested. Defaults to 2D so a 3D-capable bundle still
  // renders 2D-only until the native shell sends a 3D `loadModel.viewMode` /
  // `setViewMode` (which it only does when EXPO_PUBLIC_ENABLE_3D_VIEWER is on).
  const [viewMode, setViewMode] = useState<ViewMode>('2d');

  const bridgeRef = useRef<Bridge | null>(null);

  const floorPlan = useFloorPlanData(bundle?.floorPlansUrl, bundle?.metadataUrl);
  const hasFloorPlans = bundle?.floorPlansUrl !== undefined;
  const planReady = floorPlan.status === 'ready' && floorPlan.data !== null;

  const onHostMessage = useCallback((msg: HostMessage): void => {
    switch (msg.type) {
      case 'loadModel':
        setPdfDocUrl(null);
        setMarkers(EMPTY_MARKERS);
        setBundle(msg.bundle);
        if (msg.viewMode !== undefined) setViewMode(msg.viewMode);
        break;
      case 'loadPdf':
        setBundle(null);
        setMarkers(EMPTY_MARKERS);
        setPdfDocUrl(msg.pdfPagesUrl);
        setViewMode('2d');
        break;
      case 'setViewMode':
        setViewMode(msg.mode);
        break;
      case 'syncMarkers2D':
        setMarkers(msg.markers);
        break;
      case 'clearMarkers':
        setMarkers(EMPTY_MARKERS);
        break;
      // 3D marker / placement messages (syncMarkers / enter|exitPlaceMode /
      // setMarkersVisible / loadAnnotations) are owned by the IfcViewer pane and
      // wired in a later phase; inert here.
      default:
        break;
    }
  }, []);

  // Set up the bridge once and announce readiness.
  useEffect(() => {
    const bridge = createBridge(onHostMessage);
    bridgeRef.current = bridge;
    bridge.send({ type: 'ready' });
    return () => {
      bridge.dispose();
      bridgeRef.current = null;
    };
  }, [onHostMessage]);

  const onPaneReady = useCallback(() => {
    bridgeRef.current?.send({ type: 'sceneReady' });
    bridgeRef.current?.send({ type: 'modelLoaded' });
  }, []);

  const onPinTapped = useCallback((entityId: string) => {
    bridgeRef.current?.send({ type: 'pinTapped', id: entityId, markerType: 'finding', entityId });
  }, []);

  const onFindingPlaced = useCallback((page: number, x: number, y: number) => {
    bridgeRef.current?.send({ type: 'findingPlaced', page, x, y });
  }, []);

  // 3D pane — only when built 3D-capable (VITE_ENABLE_3D) AND the host requested a
  // 3D layout. `split` is a Phase-3 item; it currently falls through to the 2D
  // pane below until the side-by-side layout lands.
  if (ENABLE_3D && bundle && viewMode === '3d') {
    return (
      <div style={containerStyle}>
        <IfcViewer
          bundle={bundle}
          builtInPlugins="minimal"
          onReady={() => bridgeRef.current?.send({ type: 'modelLoaded' })}
          onError={(err) => bridgeRef.current?.send({ type: 'error', message: err.message })}
        />
      </div>
    );
  }

  // ---- 2D-only ----
  if (pdfDocUrl !== null) {
    return (
      <div style={containerStyle}>
        <FloorPlanPane
          pdfPagesUrl={pdfDocUrl}
          levels={[]}
          roomNames={EMPTY_ROOMS}
          markers={markers}
          onReady={onPaneReady}
          onPinTapped={onPinTapped}
          onFindingPlaced={onFindingPlaced}
        />
      </div>
    );
  }

  if (!bundle) {
    return <div style={messageStyle}>Waiting for model…</div>;
  }

  if (!hasFloorPlans || floorPlan.status === 'error') {
    return <div style={messageStyle}>No 2D view available</div>;
  }

  if (!planReady || floorPlan.data === null) {
    return <div style={messageStyle}>Loading floor plan…</div>;
  }

  return (
    <div style={containerStyle}>
      <FloorPlanPane
        data={floorPlan.data}
        levels={floorPlan.levels}
        roomNames={floorPlan.roomNames}
        onReady={onPaneReady}
      />
    </div>
  );
}

const EMPTY_ROOMS = new Map<number, string>();

const containerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
};

const messageStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 14,
};
