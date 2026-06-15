import { useCallback, useEffect, useRef, useState } from 'react';

// Value from the PDF-free 3D entry (no pdfjs in the bundle); types from the
// barrel are erased at build time, so importing them there is free.
import { IfcViewer } from '@bimstitch/viewer/viewer-3d';
import type {
  EntityMarkerData,
  ViewerBundle,
  ViewerHandle,
} from '@bimstitch/viewer';

import { createBridge, type Bridge, type HostMessage } from './bridge';

/**
 * The embeddable viewer host. Holds no domain state — it waits for the native
 * shell to push a `loadModel`, mounts `IfcViewer`, and relays viewer events
 * (`entity-marker:click`, `point:picked`) back up the bridge. Markers and
 * place-mode are driven entirely by host messages.
 */
export function App() {
  const [bundle, setBundle] = useState<ViewerBundle | null>(null);
  const [additionalBundles, setAdditionalBundles] = useState<ViewerBundle[]>([]);

  const handleRef = useRef<ViewerHandle | null>(null);
  const bridgeRef = useRef<Bridge | null>(null);
  // Markers can arrive before the viewer is ready; stash and flush on ready.
  const pendingMarkersRef = useRef<EntityMarkerData[] | null>(null);
  const eventUnsubsRef = useRef<Array<() => void>>([]);

  const exec = useCallback((name: string, args?: unknown): void => {
    handleRef.current?.commands.execute(name, args).catch(() => undefined);
  }, []);

  const onHostMessage = useCallback(
    (msg: HostMessage): void => {
      switch (msg.type) {
        case 'loadModel':
          setBundle(msg.bundle);
          setAdditionalBundles(msg.additionalBundles ?? []);
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
    [exec],
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

  const onReady = useCallback((handle: ViewerHandle): void => {
    handleRef.current = handle;
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
        .catch(() => undefined);
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

  if (!bundle) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6b7280',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 14,
        }}
      >
        Waiting for model…
      </div>
    );
  }

  return (
    <IfcViewer
      bundle={bundle}
      additionalBundles={additionalBundles}
      onReady={onReady}
      onSceneReady={() => bridgeRef.current?.send({ type: 'sceneReady' })}
      onProgress={(loaded, total) =>
        bridgeRef.current?.send({ type: 'progress', loaded, total })
      }
      onError={(err) =>
        bridgeRef.current?.send({ type: 'error', message: err.message })
      }
    />
  );
}
