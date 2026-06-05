'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ForwardedRef,
  type JSX,
  type ReactNode,
} from 'react';

import { DocumentEngine } from './pdf-core/DocumentEngine.js';
import type {
  DocumentSearchHit,
  PageDimensions,
  PdfRotation,
  PdfTool,
  SearchHighlightState,
} from './pdf-core/documentTypes.js';
import { pdfPanPlugin } from './plugins/pdf/pan/index.js';
import { pdfRotatePlugin } from './plugins/pdf/rotate/index.js';
import { pdfSearchPlugin } from './plugins/pdf/search/index.js';
import { pdfToolsPlugin } from './plugins/pdf/tools/index.js';
import { pdfZoomPlugin } from './plugins/pdf/zoom/index.js';

export type DocumentLoadedInfo = {
  numPages: number;
};

export type DocumentActiveTool = PdfTool;
export type DocumentRotation = PdfRotation;
export type SearchHighlight = SearchHighlightState;
export type { DocumentSearchHit, PageDimensions } from './pdf-core/documentTypes.js';

/**
 * Imperative handle — unchanged from the original monolithic DocumentViewer.
 * Each method is now a thin façade over a PDF-engine command, so host apps
 * (the portal toolbar, keyboard shortcuts) keep working without changes.
 */
export type DocumentViewerHandle = {
  zoomIn(): void;
  zoomOut(): void;
  /** Set scale directly. If `originClient` is provided, zoom keeps that client point stable. */
  zoomTo(scale: number, originClient?: { x: number; y: number }): void;
  /** Fit current page entirely inside the viewport. */
  fitPage(): void;
  /** Fit current page width to the viewport width. */
  fitWidth(): void;
  /** Reset to 100%. */
  actualSize(): void;
  /** Rotate by ±90°. */
  rotateBy(deg: 90 | -90): void;
  /**
   * Case-insensitive search across all pages. Returns the list of pages that
   * contain the query, with match counts. Empty / whitespace query returns [].
   * Visual highlighting is handled by the `searchHighlight` prop.
   */
  searchText(query: string): Promise<DocumentSearchHit[]>;
};

export type DocumentViewerProps = {
  fileUrl: string;
  currentPage: number;
  scale?: number;
  rotation?: DocumentRotation;
  activeTool?: DocumentActiveTool;
  className?: string;
  searchHighlight?: SearchHighlight | null;
  renderOverlay?: (dims: PageDimensions) => ReactNode;
  onLoaded?: (info: DocumentLoadedInfo) => void;
  onError?: (err: Error) => void;
  onScaleChange?: (scale: number) => void;
  onRotationChange?: (rotation: DocumentRotation) => void;
  onPageMatchCount?: (count: number) => void;
};

function DocumentViewerInner(
  {
    fileUrl,
    currentPage,
    scale = 1.0,
    rotation = 0,
    activeTool = 'select',
    className,
    searchHighlight,
    renderOverlay,
    onLoaded,
    onError,
    onScaleChange,
    onRotationChange,
    onPageMatchCount,
  }: DocumentViewerProps,
  ref: ForwardedRef<DocumentViewerHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DocumentEngine | null>(null);

  const [pageDims, setPageDims] = useState<PageDimensions | null>(null);

  // Live refs so engine event handlers and the mount-time state sync always
  // read current values without stale closures.
  const currentPageRef = useRef(currentPage);
  const scaleRef = useRef(scale);
  const rotationRef = useRef<DocumentRotation>(rotation);
  const activeToolRef = useRef<DocumentActiveTool>(activeTool);
  const searchHighlightRef = useRef<SearchHighlight | null>(searchHighlight ?? null);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  const onScaleChangeRef = useRef(onScaleChange);
  const onRotationChangeRef = useRef(onRotationChange);
  const onPageMatchCountRef = useRef(onPageMatchCount);
  useEffect(() => {
    currentPageRef.current = currentPage;
    scaleRef.current = scale;
    rotationRef.current = rotation;
    activeToolRef.current = activeTool;
    searchHighlightRef.current = searchHighlight ?? null;
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
    onScaleChangeRef.current = onScaleChange;
    onRotationChangeRef.current = onRotationChange;
    onPageMatchCountRef.current = onPageMatchCount;
  });

  // ---- Engine lifecycle. Remount only when the file changes. ----
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    const overlay = overlayRef.current;
    if (!container || !canvas || !textLayer || !overlay) return undefined;

    const engine = new DocumentEngine({
      plugins: [
        pdfToolsPlugin(),
        pdfZoomPlugin(),
        pdfPanPlugin(),
        pdfRotatePlugin(),
        pdfSearchPlugin(),
      ],
    });
    engineRef.current = engine;
    let cancelled = false;

    (async () => {
      await engine.mount({ container, canvas, textLayer, overlayHost: overlay });
      if (cancelled) return;

      engine.events.on('doc:loaded', ({ numPages }) => {
        onLoadedRef.current?.({ numPages });
      });
      engine.events.on('doc:error', ({ error }) => {
        onErrorRef.current?.(error);
      });
      engine.events.on('scale:change', ({ scale: s }) => {
        onScaleChangeRef.current?.(s);
      });
      engine.events.on('rotation:change', ({ rotation: r }) => {
        onRotationChangeRef.current?.(r);
      });
      engine.events.on('search:matchCount', ({ count }) => {
        onPageMatchCountRef.current?.(count);
      });
      engine.events.on('page:rendered', ({ dims }) => {
        setPageDims(dims);
      });

      // Seed the engine with the current controlled-prop values before load
      // (the per-prop effects below don't re-run on a file switch).
      engine.setCurrentPage(currentPageRef.current);
      engine.setScale(scaleRef.current);
      engine.setRotation(rotationRef.current);
      engine.setTool(activeToolRef.current);
      engine.setSearchHighlight(searchHighlightRef.current);

      await engine.load(fileUrl);
    })();

    return () => {
      cancelled = true;
      engine.unmount().catch(() => undefined);
      engineRef.current = null;
      setPageDims(null);
    };
  }, [fileUrl]);

  // ---- Drive controlled props into the engine ----
  useEffect(() => { engineRef.current?.setCurrentPage(currentPage); }, [currentPage]);
  useEffect(() => { engineRef.current?.setScale(scale); }, [scale]);
  useEffect(() => { engineRef.current?.setRotation(rotation); }, [rotation]);
  useEffect(() => { engineRef.current?.setTool(activeTool); }, [activeTool]);
  useEffect(() => {
    engineRef.current?.setSearchHighlight(searchHighlight ?? null);
  }, [searchHighlight]);

  // ---- Imperative handle: façade over engine commands ----
  useImperativeHandle(
    ref,
    (): DocumentViewerHandle => ({
      zoomIn: () => { void engineRef.current?.commands.execute('zoom.in'); },
      zoomOut: () => { void engineRef.current?.commands.execute('zoom.out'); },
      zoomTo: (s, origin) => {
        void engineRef.current?.commands.execute('zoom.to', { scale: s, origin });
      },
      fitPage: () => { void engineRef.current?.commands.execute('zoom.fitPage'); },
      fitWidth: () => { void engineRef.current?.commands.execute('zoom.fitWidth'); },
      actualSize: () => { void engineRef.current?.commands.execute('zoom.actualSize'); },
      rotateBy: (deg) => { void engineRef.current?.commands.execute('rotate.by', { deg }); },
      searchText: (query) =>
        engineRef.current?.commands.execute<string, DocumentSearchHit[]>(
          'search.find',
          query,
        ) ?? Promise.resolve([]),
    }),
    [],
  );

  const dims = pageDims ?? { width: 0, height: 0 };

  return (
    <div
      ref={containerRef}
      className={className}
      data-testid="document-viewer"
      style={{
        overflow: 'auto',
        background: '#f3f4f6',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '16px',
        touchAction: 'pan-x pan-y',
      }}
    >
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        />
        <div
          ref={textLayerRef}
          className="bq-text-layer"
          style={{ width: dims.width, height: dims.height }}
        />
        <div
          ref={overlayRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: dims.width,
            height: dims.height,
            pointerEvents: 'none',
          }}
        >
          {renderOverlay !== undefined && pageDims !== null
            ? renderOverlay(pageDims)
            : null}
        </div>
      </div>
    </div>
  );
}

export const DocumentViewer = forwardRef<DocumentViewerHandle, DocumentViewerProps>(
  DocumentViewerInner,
);
DocumentViewer.displayName = 'DocumentViewer';
