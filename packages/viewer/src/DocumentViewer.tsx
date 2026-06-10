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
import type { CameraControlsConfig } from './plugins/2d/camera/index.js';
import { cameraPlugin } from './plugins/2d/camera/index.js';
import { contextMenuPlugin } from './plugins/2d/context-menu/index.js';
import { entityMarker2DPlugin } from './plugins/2d/entity-marker/index.js';
import { measurePlugin } from './plugins/2d/measure/index.js';
import { markupPlugins } from './plugins/2d/markup/index.js';
import { mouseBindings2DPlugin } from './plugins/2d/mouse-bindings/index.js';
import { navCompassPlugin } from './plugins/2d/nav-compass/index.js';
import { pdfUnderlayPlugin } from './plugins/2d/pdf-underlay/index.js';
import { rotatePlugin } from './plugins/2d/rotate/index.js';
import { scenePlugin } from './plugins/2d/scene/index.js';
import { searchPlugin } from './plugins/2d/search/index.js';
import { toolsPlugin } from './plugins/2d/tools/index.js';

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
  /** Camera mouse-button → action mapping. Driven by the portal settings. */
  controls?: CameraControlsConfig;
  onProgress?: (loaded: number, total: number) => void;
  onLoaded?: (info: DocumentLoadedInfo) => void;
  onError?: (err: Error) => void;
  onScaleChange?: (scale: number) => void;
  onRotationChange?: (rotation: DocumentRotation) => void;
  onPageMatchCount?: (count: number) => void;
  onPageRendered?: (info: { pageNumber: number; dims: PageDimensions }) => void;
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
    controls,
    onProgress,
    onLoaded,
    onError,
    onScaleChange,
    onRotationChange,
    onPageMatchCount,
    onPageRendered,
  }: DocumentViewerProps,
  ref: ForwardedRef<DocumentViewerHandle>,
): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const webglHostRef = useRef<HTMLDivElement>(null);
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
  const controlsRef = useRef(controls);
  const onProgressRef = useRef(onProgress);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  const onScaleChangeRef = useRef(onScaleChange);
  const onRotationChangeRef = useRef(onRotationChange);
  const onPageRenderedRef = useRef(onPageRendered);
  const onPageMatchCountRef = useRef(onPageMatchCount);
  useEffect(() => {
    currentPageRef.current = currentPage;
    scaleRef.current = scale;
    rotationRef.current = rotation;
    activeToolRef.current = activeTool;
    searchHighlightRef.current = searchHighlight ?? null;
    navCompassRef.current = navCompass;
    controlsRef.current = controls;
    onProgressRef.current = onProgress;
    onLoadedRef.current = onLoaded;
    onErrorRef.current = onError;
    onScaleChangeRef.current = onScaleChange;
    onRotationChangeRef.current = onRotationChange;
    onPageRenderedRef.current = onPageRendered;
    onPageMatchCountRef.current = onPageMatchCount;
  });

  // ---- Engine lifecycle. Remount only when the file changes. ----
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const textLayer = textLayerRef.current;
    const overlay = overlayRef.current;
    const webglHost = webglHostRef.current;
    const viewportOverlay = viewportOverlayRef.current;
    if (!container || !canvas || !textLayer || !overlay || !webglHost || !viewportOverlay) return undefined;

    const plugins: DocumentPlugin[] = [
      toolsPlugin(),
      scenePlugin(),
      cameraPlugin(controlsRef.current ? { controls: controlsRef.current } : {}),
      pdfUnderlayPlugin(),
      mouseBindings2DPlugin(),
      rotatePlugin(),
      searchPlugin(),
      measurePlugin(),
      ...markupPlugins(),
      entityMarker2DPlugin(),
      contextMenuPlugin(),
    ];
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
        webglHost,
        viewportOverlay,
      });
      if (cancelled) return;

      engine.events.on('doc:progress', ({ loaded, total }) => {
        onProgressRef.current?.(loaded, total);
      });
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
      engine.events.on('page:rendered', ({ pageNumber, dims }) => {
        setPageDims(dims);
        onPageRenderedRef.current?.({ pageNumber, dims });
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

  // Push controls changes to the camera plugin at runtime.
  useEffect(() => {
    if (!controls || !engineRef.current) return;
    if (engineRef.current.commands.has('camera.setControls')) {
      void engineRef.current.commands.execute('camera.setControls', controls);
    }
  }, [controls]);

  // ---- Imperative handle: façade over engine commands ----
  useImperativeHandle(
    ref,
    (): DocumentViewerHandle => ({
      zoomIn: () => { void engineRef.current?.commands.execute('camera.zoomIn'); },
      zoomOut: () => { void engineRef.current?.commands.execute('camera.zoomOut'); },
      zoomTo: (s, _origin) => {
        void engineRef.current?.commands.execute('camera.zoomIn');
        // TODO: implement zoomTo with origin via camera controls
      },
      fitPage: () => { void engineRef.current?.commands.execute('camera.fitPage'); },
      fitWidth: () => { void engineRef.current?.commands.execute('camera.fitWidth'); },
      actualSize: () => { void engineRef.current?.commands.execute('camera.actualSize'); },
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
          overflow: 'hidden',
          background: '#f3f4f6',
          touchAction: 'none',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', display: 'block', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }}
        />
        <div
          ref={textLayerRef}
          className="bq-text-layer"
          style={{ position: 'absolute', width: dims.width, height: dims.height }}
        />
        <div
          ref={webglHostRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: 'none',
          }}
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
