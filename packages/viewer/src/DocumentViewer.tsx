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
import type { RasterSource } from './pdf-core/rasterSource.js';
import type { CameraControlsConfig } from './plugins/2d/camera/index.js';
import { cameraPlugin } from './plugins/2d/camera/index.js';
import { documentCameraPosePlugin } from './plugins/2d/camera-pose/index.js';
import { contextMenuPlugin } from './plugins/2d/context-menu/index.js';
import { documentPickPlugin } from './plugins/2d/document-pick/index.js';
import { entityMarker2DPlugin } from './plugins/2d/entity-marker/index.js';
import {
  floorPlanPlugin,
  type FloorPlanColors,
  type FloorPlanPluginAPI,
} from './plugins/2d/floorplan/index.js';
import { interaction2DPlugin } from './plugins/2d/interaction/index.js';
import { measurePlugin } from './plugins/2d/measure/index.js';
import { markupPlugins } from './plugins/2d/markup/index.js';
import { mouseBindings2DPlugin } from './plugins/2d/mouse-bindings/index.js';
import { navCompassPlugin } from './plugins/2d/nav-compass/index.js';
import { pdfUnderlayPlugin } from './plugins/2d/pdf-underlay/index.js';
import { rotatePlugin } from './plugins/2d/rotate/index.js';
import { scenePlugin } from './plugins/2d/scene/index.js';
import { searchPlugin } from './plugins/2d/search/index.js';
import { toolsPlugin } from './plugins/2d/tools/index.js';
import type { DecodedFloorPlans } from './plugins/3d/shared/floorplan-codec.js';

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
  /** Set the zoom level directly. */
  zoomTo(scale: number): void;
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

  // ---- Floor-plan source only (no-ops for a PDF source) ----
  /** Switch the active storey level (0-based). PDF source: maps to setCurrentPage. */
  setLevel(index: number): void;
  /** Pan/center the camera on a plan point. No-op for a PDF source. */
  focusPlanPoint(planX: number, planY: number): void;
  /** Flash a transient ring at a plan point (3D→2D selection sync). No-op for PDF. */
  pulseAt(planX: number, planY: number): void;
  /** Position the "you are here" camera marker (plan coords); null hides it. No-op for PDF. */
  setCameraPose(pose: { hereX: number; hereY: number; lookX: number; lookY: number } | null): void;

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
  /**
   * PDF source URL. Mutually exclusive with `floorPlan` — provide exactly one.
   * When `floorPlan` is set this is ignored (the engine renders vector line work
   * instead of a pdf.js raster).
   */
  fileUrl?: string;
  /**
   * Source the engine renders `fileUrl` through. The pdfjs-defaulting wrapper
   * exported from the main barrel injects `pdfjsRasterSource`; the pdfjs-free
   * `./viewer-2d` entry exports this bare component, so the mobile embed passes
   * `imageRasterSource` (server page-images). Ignored for a `floorPlan` source.
   */
  rasterSource?: RasterSource;
  /**
   * Floor-plan (vector) source — a decoded BIMFPLN2 artifact. When set, the
   * viewer renders the model-extracted floor plan through this same engine:
   * `currentPage` selects the storey level (1-based), and there is no raster
   * (the `floorplan` plugin draws the line work). Mutually exclusive with
   * `fileUrl`.
   */
  floorPlan?: DecodedFloorPlans;
  /** Floor-plan only: spaceId → room label, joined from model metadata. */
  roomNames?: Map<number, string>;
  /** Floor-plan only: theme-resolved plan colors (wall/room/label/accent). */
  colors?: Partial<FloorPlanColors>;
  /**
   * North bearing in radians, clockwise from THIS view's up-frame. When provided,
   * a static (non-interactive) north dial is shown in a corner instead of the
   * interactive page-rotation compass. For the generated floor plan this is the
   * model's `metadata.trueNorth` directly (plan-up == screen-up). For an aligned
   * PDF the portal folds the sheet rotation into it (`trueNorth + rotation_rad`)
   * so the dial points to the model's north on the rotated drawing. Omit to hide
   * it (floor plan) or fall back to the interactive dial (PDF).
   */
  trueNorth?: number;
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
  /**
   * Enable 2D→3D linking: left-click emits `document:pick` and the
   * `document.setCameraPose` command renders a you-are-here marker. Off by
   * default so plain document consumers (preview dialogs, calibration, PDF
   * findings) are unaffected. Used by the aligned-sheet 2D viewer pane.
   */
  linkPicks?: boolean;
  /** You-are-here marker color when `linkPicks` is on (theme-resolved by the host). */
  linkColor?: string;
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
    rasterSource,
    floorPlan,
    roomNames,
    colors,
    trueNorth,
    currentPage,
    scale = 1.0,
    rotation = 0,
    activeTool = 'select',
    className,
    searchHighlight,
    renderOverlay,
    navCompass,
    controls,
    linkPicks,
    linkColor,
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

  const isFloorPlan = floorPlan !== undefined;

  // Live refs so engine event handlers and the mount-time state sync always
  // read current values without stale closures.
  const rasterSourceRef = useRef(rasterSource);
  const floorPlanRef = useRef(floorPlan);
  const roomNamesRef = useRef(roomNames);
  const colorsRef = useRef(colors);
  const trueNorthRef = useRef(trueNorth);
  const currentPageRef = useRef(currentPage);
  const scaleRef = useRef(scale);
  const rotationRef = useRef<DocumentRotation>(rotation);
  const activeToolRef = useRef<DocumentActiveTool>(activeTool);
  const searchHighlightRef = useRef<SearchHighlight | null>(searchHighlight ?? null);
  const navCompassRef = useRef(navCompass);
  const controlsRef = useRef(controls);
  const linkPicksRef = useRef(linkPicks);
  const linkColorRef = useRef(linkColor);
  const onProgressRef = useRef(onProgress);
  const onLoadedRef = useRef(onLoaded);
  const onErrorRef = useRef(onError);
  const onScaleChangeRef = useRef(onScaleChange);
  const onRotationChangeRef = useRef(onRotationChange);
  const onPageRenderedRef = useRef(onPageRendered);
  const onPageMatchCountRef = useRef(onPageMatchCount);
  useEffect(() => {
    rasterSourceRef.current = rasterSource;
    floorPlanRef.current = floorPlan;
    roomNamesRef.current = roomNames;
    colorsRef.current = colors;
    trueNorthRef.current = trueNorth;
    currentPageRef.current = currentPage;
    scaleRef.current = scale;
    rotationRef.current = rotation;
    activeToolRef.current = activeTool;
    searchHighlightRef.current = searchHighlight ?? null;
    navCompassRef.current = navCompass;
    controlsRef.current = controls;
    linkPicksRef.current = linkPicks;
    linkColorRef.current = linkColor;
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

    const fp = floorPlanRef.current;

    // ---- One plugin stack for BOTH sources ----
    // The shared core (tools/scene/camera + mouse-bindings + measure / markup /
    // entity-marker / interaction / context-menu) is identical for a PDF and a
    // floor plan, so the two surfaces behave the same. Only genuinely
    // source-specific plugins differ: a PDF mounts the raster underlay + search +
    // page rotate; a floor plan mounts the vector `floorplan` renderer. Both can
    // drive the 2D↔3D link and its draggable you-are-here marker.
    const isFp = fp !== undefined;
    const plugins: DocumentPlugin[] = [
      toolsPlugin(),
      scenePlugin(),
      cameraPlugin(controlsRef.current ? { controls: controlsRef.current } : {}),
    ];

    // PDF raster underlay (positions the canvas + fits the camera on first
    // render). A floor plan has no raster — floorPlanPlugin does the first fit.
    if (!isFp) plugins.push(pdfUnderlayPlugin());

    // Left-click routing: a floor plan always resolves to its nearest-room pick;
    // a PDF resolves to `document.pick` (2D→3D fly) only when linking is on, else
    // the click falls through to select / measure.
    plugins.push(
      mouseBindings2DPlugin(
        isFp
          ? { overrides: { 'click:left': 'floorplan.pick' } }
          : linkPicksRef.current
            ? { overrides: { 'click:left': 'document.pick' } }
            : {},
      ),
    );

    // PDF-only document chrome (a vector plan has no text layer or rotation).
    if (!isFp) plugins.push(rotatePlugin(), searchPlugin());

    // Shared annotation + interaction stack — identical for both sources, so
    // measure, markup, finding pins, guided-pick placement, and the right-click
    // context menu work the same on a drawing and a PDF.
    plugins.push(
      measurePlugin(),
      ...markupPlugins(),
      entityMarker2DPlugin(),
      interaction2DPlugin(),
      contextMenuPlugin(),
    );

    if (isFp) {
      // Vector line work + storey switching + 2D↔3D linking (floorplan.pick /
      // floorplan:cameraPose) + the draggable you-are-here marker.
      plugins.push(
        floorPlanPlugin({
          data: fp,
          ...(roomNamesRef.current ? { roomNames: roomNamesRef.current } : {}),
          ...(colorsRef.current ? { colors: colorsRef.current } : {}),
        }),
      );
    } else if (linkPicksRef.current) {
      // 2D→3D linking surface: page-pick events + the draggable you-are-here
      // camera marker (parity with the floor plan's marker).
      plugins.push(
        documentPickPlugin(),
        documentCameraPosePlugin(linkColorRef.current ? { color: linkColorRef.current } : {}),
      );
    }

    // North compass. A provided `trueNorth` bearing (radians, CW from this view's
    // up-frame) mounts the STATIC true-north dial — for the generated floor plan
    // AND for an aligned PDF (the portal folds the sheet rotation into the bearing
    // so it points to the model's north). A PDF with no bearing falls back to the
    // interactive page-rotation dial (which depends on `rotate`).
    if (trueNorthRef.current !== undefined) {
      plugins.push(
        navCompassPlugin({
          northDeg: (trueNorthRef.current * 180) / Math.PI,
          locale: navCompassRef.current?.locale ?? 'nl',
        }),
      );
    } else if (!isFp && navCompassRef.current?.enabled !== false) {
      plugins.push(navCompassPlugin({ locale: navCompassRef.current?.locale ?? 'nl' }));
    }

    const engine = new DocumentEngine(
      rasterSourceRef.current !== undefined
        ? { plugins, rasterSource: rasterSourceRef.current }
        : { plugins },
    );
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

      // Vector floor plan (synchronous) or pdf.js document (async). Exactly one
      // source is provided; floorPlan wins if both are set.
      if (fp !== undefined) {
        engine.loadFloorPlan(fp);
      } else if (fileUrl !== undefined) {
        await engine.load(fileUrl);
      }
    })();

    return () => {
      cancelled = true;
      engine.unmount().catch(() => undefined);
      engineRef.current = null;
      setPageDims(null);
    };
  }, [fileUrl, floorPlan]);

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
      zoomTo: (scale) => {
        void engineRef.current?.commands.execute('camera.zoomTo', { zoom: scale });
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
      // Floor-plan source façades. getPlugin('floorplan') is null for a PDF
      // source, so these no-op there.
      setLevel: (index) => { engineRef.current?.setCurrentPage(index + 1); },
      focusPlanPoint: (planX, planY) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.focusPlanPoint(planX, planY);
      },
      pulseAt: (planX, planY) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.pulseAt(planX, planY);
      },
      setCameraPose: (pose) => {
        engineRef.current?.getPlugin<FloorPlanPluginAPI>('floorplan')?.setCameraPose(pose);
      },
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
          // Floor-plan mode has no raster — stay transparent so the host pane's
          // surface shows through.
          background: isFloorPlan ? 'transparent' : '#f3f4f6',
          touchAction: 'none',
        }}
      >
        {/* canvas + textLayer satisfy the DocumentContext contract but are unused
            in floor-plan mode (no raster, no text layer) — kept hidden. */}
        <canvas
          ref={canvasRef}
          style={
            isFloorPlan
              ? { position: 'absolute', display: 'none' }
              : { position: 'absolute', display: 'block', boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }
          }
        />
        <div
          ref={textLayerRef}
          className="bq-text-layer"
          style={
            isFloorPlan
              ? { position: 'absolute', display: 'none' }
              : { position: 'absolute', width: dims.width, height: dims.height }
          }
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
