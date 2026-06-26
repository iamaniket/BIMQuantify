import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

// 3D entry kept imported but dormant in v1 (see ENABLE_3D). Types from the barrel
// are erased at build time, so importing them there is free.
import { IfcViewer } from '@bimdossier/viewer/viewer-3d';
import type { ViewerBundle } from '@bimdossier/viewer';

import { createBridge, type Bridge, type EntityMarker2D, type HostMessage } from './bridge';
import { FloorPlanPane } from './FloorPlanPane';
import { useFloorPlanData } from './useFloorPlanData';

/**
 * v1 is **2D-only**: the embed renders the unified `DocumentViewer` (floor plans
 * + PDFs) with an in-webview 2D toolbar and finding pins — no 3D, no Split, no
 * view-mode switcher. The 3D `IfcViewer` stays imported but dormant behind
 * `ENABLE_3D`; flipping it on re-mounts the 3D pane (the richer 3D snagging
 * wiring — markers/place/isolation/split — is restorable from git history).
 *
 * Native owns all state; this bundle is a stateless render-and-report surface
 * driven over the postMessage bridge.
 */
const ENABLE_3D = false as boolean;

const EMPTY_MARKERS: EntityMarker2D[] = [];

export function App() {
  // IFC model bundle (its floor plan is the 2D source). Mutually exclusive with pdfDocUrl.
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  // PDF document: the page-image manifest URL (2D-only, no IFC model).
  const [pdfDocUrl, setPdfDocUrl] = useState<string | null>(null);
  const [markers, setMarkers] = useState<EntityMarker2D[]>(EMPTY_MARKERS);

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
        break;
      case 'loadPdf':
        setBundle(null);
        setMarkers(EMPTY_MARKERS);
        setPdfDocUrl(msg.pdfPagesUrl);
        break;
      case 'syncMarkers2D':
        setMarkers(msg.markers);
        break;
      case 'clearMarkers':
        setMarkers(EMPTY_MARKERS);
        break;
      // 3D-only messages (setViewMode / syncMarkers / enter|exitPlaceMode /
      // setMarkersVisible / loadAnnotations) are inert in the 2D-only v1.
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

  // Dormant 3D path — flip ENABLE_3D to re-enable (v1 never takes this branch).
  if (ENABLE_3D && bundle) {
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
