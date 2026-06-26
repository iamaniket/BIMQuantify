import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

// Value from the PDF-free 3D entry (no pdfjs in the bundle); types from the
// barrel are erased at build time, so importing them there is free.
import { IfcViewer } from '@bimdossier/viewer/viewer-3d';
import type {
  EntityMarkerData,
  ViewerBundle,
  ViewerHandle,
} from '@bimdossier/viewer';

import { createBridge, type Bridge, type HostMessage, type ViewMode } from './bridge';
import { FloorPlanPane } from './FloorPlanPane';
import { useFloorPlanData } from './useFloorPlanData';

/** Clamp the split divider so neither pane collapses. */
const SPLIT_MIN = 0.2;
const SPLIT_MAX = 0.8;

/**
 * The embeddable viewer host. Holds no domain state — it waits for the native
 * shell to push a `loadModel`, then composes the 3D `IfcViewer` and the 2D plan
 * pane into one of three layouts (3D / 2D / Split) chosen by the native dropdown
 * over the bridge. The 3D viewer stays mounted across switches (hidden in 2D) to
 * avoid costly fragment reloads. Markers and place-mode are driven entirely by
 * host messages.
 *
 * NOTE: the 2D plan pane is currently STUBBED — the standalone pdfjs-free
 * floor-plan viewer was removed from `@bimdossier/viewer` (the web now has a
 * single `DocumentViewer`) and a dedicated mobile 2D viewer will be rebuilt
 * separately. Until then the embed defaults to 3D and the 2D/Split pane shows a
 * placeholder.
 */
export function App() {
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  const [additionalBundles, setAdditionalBundles] = useState<ViewerBundle[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>('3d');
  const [activeLevel, setActiveLevel] = useState(0);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const [viewerReady, setViewerReady] = useState(false);

  const handleRef = useRef<ViewerHandle | null>(null);
  const bridgeRef = useRef<Bridge | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  // Markers can arrive before the viewer is ready; stash and flush on ready.
  const pendingMarkersRef = useRef<EntityMarkerData[] | null>(null);
  const eventUnsubsRef = useRef<Array<() => void>>([]);

  const floorPlan = useFloorPlanData(bundle?.floorPlansUrl, bundle?.metadataUrl);
  const hasFloorPlans = bundle?.floorPlansUrl !== undefined;
  const planReady = floorPlan.status === 'ready' && floorPlan.data !== null;

  const exec = useCallback((name: string, args?: unknown): void => {
    handleRef.current?.commands.execute(name, args).catch((err: unknown) => {
      // Don't swallow: a failed marker-sync / placement / isolate otherwise
      // leaves a misleading view and the native host never learns. console.error
      // is forwarded over the bridge to Metro/Logcat.
      console.error(`[viewer-embed] command "${name}" failed`, err);
    });
  }, []);

  // A 2D/Split request only sticks when this model actually has a plan; the
  // native dropdown already gates this, but coerce defensively.
  const requestViewMode = useCallback(
    (mode: ViewMode): void => {
      setViewMode(mode !== '3d' && !hasFloorPlans ? '3d' : mode);
    },
    [hasFloorPlans],
  );

  const onHostMessage = useCallback(
    (msg: HostMessage): void => {
      switch (msg.type) {
        case 'loadModel':
          setViewerReady(false);
          setBundle(msg.bundle);
          setAdditionalBundles(msg.additionalBundles ?? []);
          setActiveLevel(0);
          // 2D plan rendering is stubbed (see file header), so default to 3D
          // regardless of floor-plan availability; honor an explicit host mode.
          setViewMode(msg.viewMode ?? '3d');
          break;
        case 'setViewMode':
          requestViewMode(msg.mode);
          break;
        case 'syncMarkers':
          if (handleRef.current) exec('entity-marker.sync', msg.markers);
          else pendingMarkersRef.current = msg.markers;
          break;
        case 'clearMarkers':
          pendingMarkersRef.current = null;
          exec('entity-marker.clear');
          break;
        case 'setMarkersVisible':
          exec('entity-marker.setVisible', { visible: msg.visible });
          break;
        case 'enterPlaceMode':
          // Default to one-shot: a single tap places one anchor, then the host
          // opens its finding form. Pass `oneShot: false` for sticky placement.
          exec('placement.enter', { oneShot: msg.oneShot ?? true });
          break;
        case 'exitPlaceMode':
          exec('placement.exit');
          break;
      }
    },
    [exec, requestViewMode],
  );

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

  // If a 2D/Split mode was requested but the plan failed to decode (or has no
  // levels), fall back to 3D rather than showing a blank pane. Gated on the
  // explicit 'error' status so it never fires before the fetch has run.
  useEffect(() => {
    if (viewMode !== '3d' && floorPlan.status === 'error') {
      setViewMode('3d');
    }
  }, [viewMode, floorPlan.status]);

  // The 3D pane is always sized (see layout note below), but a mode change can
  // alter its dimensions (e.g. 3D↔Split). ThatOpen's renderer resizes from the
  // container via a ResizeObserver AND a window 'resize' listener; nudge the
  // latter so it re-reads the size. Use a timeout, NOT requestAnimationFrame —
  // rAF is paused when the WebView/tab is backgrounded, which would silently
  // drop the nudge.
  useEffect(() => {
    const id = setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 0);
    return () => {
      clearTimeout(id);
    };
  }, [viewMode]);

  // Storey isolation: when in 2D/Split mode, isolate the active level's
  // elements in 3D so only that floor is visible. Restore on mode switch.
  useEffect(() => {
    if (!viewerReady || !bundle) return undefined;
    const handle = handleRef.current;
    if (!handle) return undefined;

    const levels = floorPlan.levels;
    const membership = floorPlan.storeyMembership;
    const lvl = levels[activeLevel];
    const shouldIsolate = viewMode !== '3d' && lvl != null;

    if (shouldIsolate) {
      const localIds = membership.get(lvl.storeyExpressID) ?? [];
      if (localIds.length > 0) {
        const modelId = bundle.modelId;
        const items = localIds.map((localId) => ({ modelId, localId }));
        handle.commands.execute('visibility.isolateItem', items).catch((err: unknown) => { console.error('[viewer-embed] visibility.isolateItem failed', err); });
      }
    } else {
      handle.commands.execute('visibility.showAll').catch((err: unknown) => { console.error('[viewer-embed] visibility.showAll failed', err); });
    }

    return () => {
      handle.commands.execute('visibility.showAll').catch((err: unknown) => { console.error('[viewer-embed] visibility.showAll failed', err); });
    };
  }, [viewerReady, activeLevel, viewMode, bundle, floorPlan.levels, floorPlan.storeyMembership]);

  const onReady = useCallback((handle: ViewerHandle): void => {
    handleRef.current = handle;
    setViewerReady(true);
    const bridge = bridgeRef.current;

    // Re-mounts create a fresh event bus — drop any prior subscriptions first.
    for (const off of eventUnsubsRef.current) off();
    eventUnsubsRef.current = [
      handle.events.on('entity-marker:click', (ev) => {
        bridge?.send({
          type: 'pinTapped',
          id: ev.id,
          markerType: ev.type,
          entityId: ev.entityId,
          position: ev.position,
        });
      }),
      handle.events.on('point:picked', (ev) => {
        bridge?.send({ type: 'pointPicked', point: ev.point, item: ev.item });
      }),
    ];

    // Flush markers that arrived before the viewer was ready.
    if (pendingMarkersRef.current) {
      handle.commands
        .execute('entity-marker.sync', pendingMarkersRef.current)
        .catch((err: unknown) => { console.error('[viewer-embed] entity-marker.sync (pending flush) failed', err); });
      pendingMarkersRef.current = null;
    }

    bridge?.send({ type: 'modelLoaded' });
  }, []);

  useEffect(
    () => () => {
      for (const off of eventUnsubsRef.current) off();
      eventUnsubsRef.current = [];
    },
    [],
  );

  const onDividerPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
  }, []);

  const onDividerPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return;
    const r = (e.clientY - rect.top) / rect.height;
    setSplitRatio(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, r)));
  }, []);

  const onDividerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  if (!bundle) {
    return <div style={waitingStyle}>Waiting for model…</div>;
  }

  const showPlan = viewMode !== '3d' && planReady;
  // The 3D pane is ALWAYS mounted AND sized — never `display:none`. ThatOpen's
  // renderer latches its drawing-buffer size from the container at init, so a
  // 0×0 (display:none) container leaves the canvas stuck at 0×0 with no repaint.
  // In 2D the 3D pane therefore stays full-size but sits BEHIND the opaque plan
  // pane (which covers it); in Split it's the top region.
  const threeDStyle: CSSProperties =
    viewMode === 'split'
      ? { position: 'absolute', top: 0, left: 0, right: 0, height: `${splitRatio * 100}%`, zIndex: 1 }
      : { ...fillStyle, zIndex: 1 };
  const planStyle: CSSProperties =
    viewMode === 'split'
      ? {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: `${(1 - splitRatio) * 100}%`,
          borderTop: '1px solid #e5e7eb',
          zIndex: 2,
          background: '#ffffff',
        }
      : { ...fillStyle, zIndex: 2, background: '#ffffff' };

  return (
    <div ref={containerRef} style={containerStyle}>
      {/* 3D — always mounted (hidden in 2D) so fragments aren't reloaded. */}
      <div style={threeDStyle}>
        <IfcViewer
          bundle={bundle}
          additionalBundles={additionalBundles}
          viewCube={{ size: 80 }}
          // Snagging-only plugin set: the embed drives orbit + tap-select +
          // pins + tap-to-place, so it skips the ~16 desktop-only plugins
          // (measurement, minimap, classifier, BCF, section, …) the phone never
          // uses — less install-time work, memory, and per-frame event fan-out.
          builtInPlugins="minimal"
          // Mobile motion optimizations. The portal turns these on through its
          // viewer settings (viewerSettings.ts), but the embed has no settings
          // UI, so the interactive-performance plugin would otherwise run at its
          // OFF-by-default values on phones — the worst case for the device that
          // needs them most. Both only reduce fidelity WHILE the camera is moving
          // (the idle frame is always full quality): drop the device-pixel-ratio
          // during an orbit/pan and skip the expensive GPU/worker hover raycasts
          // the user can't perceive mid-motion.
          interactivePerformance={{
            dynamicPixelRatio: true,
            pauseHover: true,
            motionRatio: 0.5,
          }}
          // Smaller baked contact-shadow RT on phones: softer blob-shadow edges
          // for cheaper bake + sampling. Does not touch model rendering quality.
          shadows={{ resolution: 512 }}
          onReady={onReady}
          onSceneReady={() => bridgeRef.current?.send({ type: 'sceneReady' })}
          onProgress={(loaded, total) =>
            bridgeRef.current?.send({ type: 'progress', loaded, total })
          }
          onError={(err) => bridgeRef.current?.send({ type: 'error', message: err.message })}
        />
      </div>

      {/* 2D — mounted only in 2D/Split. */}
      {showPlan && floorPlan.data ? (
        <div style={planStyle}>
          <FloorPlanPane
            data={floorPlan.data}
            levels={floorPlan.levels}
            roomNames={floorPlan.roomNames}
            activeLevel={activeLevel}
            onLevelChange={setActiveLevel}
          />
        </div>
      ) : null}

      {/* Draggable divider — Split only. */}
      {viewMode === 'split' && showPlan ? (
        <div
          style={{ ...dividerStyle, top: `calc(${splitRatio * 100}% - 6px)` }}
          onPointerDown={onDividerPointerDown}
          onPointerMove={onDividerPointerMove}
          onPointerUp={onDividerPointerUp}
          onPointerCancel={onDividerPointerUp}
        >
          <div style={dividerGripStyle} />
        </div>
      ) : null}

      {/* Plan still decoding while in 2D/Split. */}
      {viewMode !== '3d' && !planReady && floorPlan.status !== 'error' ? (
        <div style={planLoadingStyle}>Loading floor plan…</div>
      ) : null}
    </div>
  );
}

const containerStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
};

const fillStyle: CSSProperties = { position: 'absolute', inset: 0 };

const dividerStyle: CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  height: 12,
  zIndex: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'row-resize',
  touchAction: 'none',
};

const dividerGripStyle: CSSProperties = {
  width: 44,
  height: 5,
  borderRadius: 999,
  background: '#9ca3af',
  boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
};

const planLoadingStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 14,
  pointerEvents: 'none',
};

const waitingStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 14,
};
