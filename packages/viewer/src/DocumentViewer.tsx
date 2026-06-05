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

import type { EventBus } from './core/EventBus.js';
import { DocumentEngine } from './pdf-core/DocumentEngine.js';
import type {
  DocumentEvents,
  DocumentPlugin,
  DocumentSearchHit,
  PageDimensions,
  DocumentRotation,
  DocumentTool,
  SearchHighlightState,
} from './pdf-core/documentTypes.js';
import { measurePlugin } from './plugins/2d/measure/index.js';
import { navCompassPlugin } from './plugins/2d/nav-compass/index.js';
import { panPlugin } from './plugins/2d/pan/index.js';
import { rotatePlugin } from './plugins/2d/rotate/index.js';
import { searchPlugin } from './plugins/2d/search/index.js';
import { toolsPlugin } from './plugins/2d/tools/index.js';
import { zoomPlugin } from './plugins/2d/zoom/index.js';
import { contextMenuPlugin } from './plugins/2d/context-menu/index.js';

export type DocumentLoadedInfo = {
  numPages: number;
};

export type DocumentActiveTool = DocumentTool;
export type SearchHighlight = SearchHighlightState;
export type { DocumentRotation };
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

  /**
   * Generic command / event / plugin surface — the 2D counterpart to the 3D
   * `ViewerHandle`. Host apps drive measurement (and any future 2D plugin)
   * through these without a typed façade per command. The façade methods above
   * are kept so the existing toolbar + keyboard shortcuts work unchanged.
   */
  commands: {
    execute<R = unknown>(name: string, args?: unknown): Promise<R>;
    has(name: string): boolean;
    list(): { name: string; meta: unknown }[];
  };
  events: Pick<EventBus<DocumentEvents>, 'on' | 'off' | 'once'>;
  plugins: {
    register(plugin: DocumentPlugin): Promise<void>;
    unregister(name: string): Promise<void>;
    get<T = unknown>(name: string): T | null;
  };
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
  /**
   * Top-left orientation compass (the 2D analog of the 3D ViewCube). Enabled by
   * default; `enabled: false` omits the plugin. `locale` defaults to 'nl'.
   */
  navCompass?: { enabled?: boolean; locale?: 'en' | 'nl' };
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
    navCompass,
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
  const viewportOverlayRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<DocumentEngine | null>(null);

  const [pageDims, setPageDims] = useState<PageDimensions | null>(null);

  // Live refs so engine event handlers and the mount-time state sync always
  // read current values without stale closures.
  const currentPageRef = useRef(currentPage);
  const scaleRef = useRef(scale);
  const rotationRef = useRef<DocumentRotation>(rotation);
  const activeToolRef = useRef<DocumentActiveTool>(activeTool);
  const searchHighlightRef = useRef<SearchHighlight | null>(searchHighlight ?? null);
  const navCompassRef = useRef(navCompass);
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
    navCompassRef.current = navCompass;
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
    const viewportOverlay = viewportOverlayRef.current;
    if (!container || !canvas || !textLayer || !overlay || !viewportOverlay) return undefined;

    const plugins: DocumentPlugin[] = [
      toolsPlugin(),
      zoomPlugin(),
      panPlugin(),
      rotatePlugin(),
      searchPlugin(),
      measurePlugin(),
      contextMenuPlugin(),
    ];
    // nav-compass is read at mount only (like scale/rotation/tool) — kept out of
    // the effect deps so a fresh `navCompass` object literal can't force a remount.
    if (navCompassRef.current?.enabled !== false) {
      plugins.push(navCompassPlugin({ locale: navCompassRef.current?.locale ?? 'nl' }));
    }

    const engine = new DocumentEngine({ plugins });
    engineRef.current = engine;
    let cancelled = false;

    (async () => {
      await engine.mount({
        container,
        canvas,
        textLayer,
        overlayHost: overlay,
        viewportOverlay,
      });
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
      commands: {
        execute: <R,>(name: string, args?: unknown): Promise<R> => {
          const e = engineRef.current;
          if (!e) return Promise.reject(new Error('DocumentViewer not mounted'));
          return e.commands.execute<unknown, R>(name, args);
        },
        has: (name: string) => engineRef.current?.commands.has(name) ?? false,
        list: () => engineRef.current?.commands.list() ?? [],
      },
      events: {
        on: (key, h) => engineRef.current?.events.on(key, h) ?? (() => undefined),
        off: (key, h) => engineRef.current?.events.off(key, h),
        once: (key, h) => engineRef.current?.events.once(key, h) ?? (() => undefined),
      },
      plugins: {
        register: async (p) => { await engineRef.current?.registerPlugin(p); },
        unregister: async (name) => { await engineRef.current?.unregisterPlugin(name); },
        get: <T,>(name: string): T | null => engineRef.current?.getPlugin<T>(name) ?? null,
      },
    }),
    [],
  );

  const dims = pageDims ?? { width: 0, height: 0 };

  return (
    // Outer shell carries the consumer's className (which must position it, e.g.
    // `absolute inset-0`) so it becomes the containing block for the
    // viewport-anchored overlay. The scroll container fills it.
    <div
      className={className}
      data-testid="document-viewer-shell"
      style={{ overflow: 'hidden' }}
    >
      <div
        ref={containerRef}
        data-testid="document-viewer"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
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
      {/* Viewport-anchored overlay: NOT inside the scroll container, so plugins
          like nav-compass stay pinned to the viewport corner. */}
      <div
        ref={viewportOverlayRef}
        data-testid="document-viewport-overlay"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, pointerEvents: 'none' }}
      />
    </div>
  );
}

export const DocumentViewer = forwardRef<DocumentViewerHandle, DocumentViewerProps>(
  DocumentViewerInner,
);
DocumentViewer.displayName = 'DocumentViewer';
