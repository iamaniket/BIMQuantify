import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

// The pdfjs-FREE 2D entry: the same `DocumentViewer` + plugin ecosystem the web
// portal uses, but its bundle never pulls pdf.js (PDFs render from server
// page-images via `imageRasterSource`, not on-device pdf.js).
import { DocumentViewer, imageRasterSource } from '@bimdossier/viewer/viewer-2d';
import type { DecodedFloorPlans, DocumentViewerHandle } from '@bimdossier/viewer/viewer-2d';

import type { EntityMarker2D } from './bridge';
import type { FloorPlanLevelInfo } from './useFloorPlanData';

type Props = {
  /** Generated floor plan (IFC models). Mutually exclusive with `pdfPagesUrl`. */
  data?: DecodedFloorPlans;
  /** Server page-image manifest (PDF documents). Mutually exclusive with `data`. */
  pdfPagesUrl?: string;
  levels: FloorPlanLevelInfo[];
  roomNames: Map<number, string>;
  /** Finding pins for ALL pages; the pane shows only the visible page's. */
  markers?: EntityMarker2D[];
  /** Fired once the 2D document has loaded (host clears its load spinner). */
  onReady?: () => void;
  /** A finding pin was tapped → host opens the finding detail. */
  onPinTapped?: (entityId: string) => void;
  /** A guided pick resolved on `page` at normalized `(x, y)` → host opens create form. */
  onFindingPlaced?: (page: number, x: number, y: number) => void;
};

/**
 * The mobile 2D viewer. Renders BOTH a generated floor plan (BIMFPLN2 `data`)
 * and an uploaded PDF (`pdfPagesUrl` → server page-images) through ONE
 * `DocumentViewer`, with an in-webview touch toolbar (zoom / fit / page-or-level
 * nav, plus place-finding for PDFs). Finding pins + placement ride the same 2D
 * plugin ecosystem the web viewer uses.
 *
 * v1 scope: navigation everywhere; finding pins on PDFs (natively 2D-anchored).
 * Floor plans are view-only (model findings are 3D-anchored — projecting them is
 * a fast-follow).
 */
export function FloorPlanPane({
  data,
  pdfPagesUrl,
  levels,
  roomNames,
  markers,
  onReady,
  onPinTapped,
  onFindingPlaced,
}: Props) {
  const isPdf = pdfPagesUrl !== undefined && data === undefined;
  const docRef = useRef<DocumentViewerHandle | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [placing, setPlacing] = useState(false);
  // Bumped on every (re)load so the event-subscription effect re-binds to the
  // fresh engine bus (DocumentViewer remounts when the source changes).
  const [readyTick, setReadyTick] = useState(0);

  const pageCount = isPdf ? numPages : (data?.levels.length ?? 0);

  // Live refs so engine-event handlers never read stale callbacks/state.
  const onPinTappedRef = useRef(onPinTapped);
  const onFindingPlacedRef = useRef(onFindingPlaced);
  const markersRef = useRef(markers);
  const currentPageRef = useRef(currentPage);
  useEffect(() => {
    onPinTappedRef.current = onPinTapped;
    onFindingPlacedRef.current = onFindingPlaced;
    markersRef.current = markers;
    currentPageRef.current = currentPage;
  });

  // New document → back to the first page/level.
  useEffect(() => {
    setCurrentPage(1);
  }, [data, pdfPagesUrl]);

  const handleLoaded = useCallback(
    (info: { numPages: number }) => {
      setNumPages(info.numPages);
      setReadyTick((t) => t + 1);
      onReady?.();
    },
    [onReady],
  );

  // Subscribe to pin taps + guided-pick resolution once the engine is live.
  useEffect(() => {
    const handle = docRef.current;
    if (handle === null || readyTick === 0) return undefined;
    const offClick = handle.events.on('entity-marker:click', (ev) => {
      onPinTappedRef.current?.(ev.entityId);
    });
    const offResolved = handle.events.on('interaction:resolved', (ev) => {
      if (ev.kind !== 'page') return;
      setPlacing(false);
      onFindingPlacedRef.current?.(ev.page, ev.x, ev.y);
    });
    const offCancelled = handle.events.on('interaction:cancelled', () => {
      setPlacing(false);
    });
    return () => {
      offClick();
      offResolved();
      offCancelled();
    };
  }, [readyTick]);

  // Sync the visible page's finding pins into the 2D entity-marker plugin.
  useEffect(() => {
    const handle = docRef.current;
    if (handle === null || readyTick === 0 || !isPdf) return;
    const forPage = (markers ?? [])
      .filter((m) => m.page === currentPage)
      .map((m) => ({
        id: m.id,
        type: m.type,
        x: m.x,
        y: m.y,
        label: m.label,
        entityId: m.entityId,
        status: m.status,
      }));
    void handle.commands.execute('entity-marker-2d.sync', forPage);
  }, [readyTick, currentPage, markers, isPdf]);

  const goPrev = useCallback(() => setCurrentPage((p) => Math.max(1, p - 1)), []);
  const goNext = useCallback(
    () => setCurrentPage((p) => Math.min(pageCount || 1, p + 1)),
    [pageCount],
  );
  const togglePlace = useCallback(() => {
    const handle = docRef.current;
    if (handle === null) return;
    if (placing) {
      if (handle.commands.has('interaction.cancel')) {
        void handle.commands.execute('interaction.cancel');
      }
      setPlacing(false);
      return;
    }
    void handle.commands.execute('interaction.request', {
      placeType: 'finding',
      message: 'Tap the drawing to place the finding',
    });
    setPlacing(true);
  }, [placing]);

  const pageLabel = isPdf
    ? `${String(Math.min(currentPage, pageCount || 1))} / ${String(pageCount || 1)}`
    : (levels[currentPage - 1]?.name ?? `Level ${String(currentPage - 1)}`);

  return (
    <div style={paneStyle}>
      {isPdf ? (
        <DocumentViewer
          ref={docRef}
          fileUrl={pdfPagesUrl}
          rasterSource={imageRasterSource}
          currentPage={currentPage}
          navCompass={{ enabled: false }}
          onLoaded={handleLoaded}
        />
      ) : data !== undefined ? (
        <DocumentViewer
          ref={docRef}
          floorPlan={data}
          roomNames={roomNames}
          currentPage={currentPage}
          onLoaded={handleLoaded}
        />
      ) : (
        <div style={messageStyle}>No 2D view available</div>
      )}

      {(isPdf || data !== undefined) ? (
        <div style={toolbarStyle}>
          <button type="button" style={btnStyle} onClick={() => docRef.current?.zoomOut()} aria-label="Zoom out">
            −
          </button>
          <button type="button" style={btnStyle} onClick={() => docRef.current?.zoomIn()} aria-label="Zoom in">
            +
          </button>
          <button type="button" style={btnStyle} onClick={() => docRef.current?.fitPage()} aria-label="Fit">
            ⤢
          </button>
          {pageCount > 1 ? (
            <>
              <span style={dividerStyle} />
              <button type="button" style={btnStyle} onClick={goPrev} disabled={currentPage <= 1} aria-label="Previous">
                ‹
              </button>
              <span style={labelStyle}>{pageLabel}</span>
              <button
                type="button"
                style={btnStyle}
                onClick={goNext}
                disabled={currentPage >= (pageCount || 1)}
                aria-label="Next"
              >
                ›
              </button>
            </>
          ) : null}
          {isPdf ? (
            <>
              <span style={dividerStyle} />
              <button
                type="button"
                style={placing ? btnActiveStyle : btnStyle}
                onClick={togglePlace}
                aria-label="Place finding"
              >
                📌
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const paneStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: '#ffffff',
};

const messageStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6b7280',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 14,
};

const toolbarStyle: CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderRadius: 999,
  background: 'rgba(17,24,39,0.88)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
  touchAction: 'manipulation',
  zIndex: 10,
};

const btnStyle: CSSProperties = {
  minWidth: 40,
  height: 40,
  padding: '0 10px',
  border: 'none',
  borderRadius: 999,
  background: 'transparent',
  color: '#f9fafb',
  fontSize: 20,
  lineHeight: '40px',
  cursor: 'pointer',
};

const btnActiveStyle: CSSProperties = {
  ...btnStyle,
  background: '#2563eb',
};

const labelStyle: CSSProperties = {
  color: '#e5e7eb',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
  fontSize: 13,
  padding: '0 6px',
  minWidth: 56,
  textAlign: 'center',
};

const dividerStyle: CSSProperties = {
  width: 1,
  height: 22,
  background: 'rgba(255,255,255,0.18)',
  margin: '0 2px',
};
