/**
 * DocumentEngine — the PDF counterpart to `core/Viewer.ts`. Owns the pdf.js
 * document, page + TextLayer rendering, and the authoritative viewer state
 * (current page, scale, rotation, tool). Hosts PDF plugins via the shared
 * generic `PluginManager`; plugins drive interaction (zoom/pan/search/…)
 * through the `DocumentContext`.
 *
 * Rendering lives here, NOT in a plugin — the same split as the 3D engine,
 * where `Viewer.ts` owns the scene/render loop and plugins own behavior.
 */

import { CommandRegistry } from '../core/CommandRegistry.js';
import { EventBus } from '../core/EventBus.js';
import { PluginManager } from '../core/plugin.js';
import {
  clampScale,
  MAX_CANVAS_DIM,
  type DocumentContext,
  type DocumentEvents,
  type DocumentPlugin,
  type PageDimensions,
  type DocumentRotation,
  type DocumentTool,
  type SearchHighlightState,
} from './documentTypes.js';
import {
  RasterRenderAborted,
  type RasterDocument,
  type RasterSource,
} from './rasterSource.js';
import type { DecodedFloorPlans, FloorPlanLevel } from '../plugins/3d/shared/floorplan-codec.js';
import { unionBbox, type PlanBbox } from '../plugins/3d/shared/floorplanBbox.js';

interface DocumentEngineOptions {
  /** Plugins to register at mount. Order matters for dependencies. */
  plugins?: DocumentPlugin[];
  /**
   * Source the engine renders a PDF (or any paged raster) through: pdf.js on
   * web (`pdfjsRasterSource`), server page-images on mobile
   * (`imageRasterSource`). Not needed for a floor-plan source — `loadFloorPlan`
   * renders vector line work with no raster.
   */
  rasterSource?: RasterSource;
}

interface MountElements {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  textLayer: HTMLElement;
  overlayHost: HTMLElement;
  webglHost: HTMLElement;
  viewportOverlay: HTMLElement;
}

export class DocumentEngine {
  readonly events = new EventBus<DocumentEvents>();
  readonly commands = new CommandRegistry();

  private pluginManager: PluginManager<DocumentContext, DocumentEvents> | null = null;

  // DOM, set at mount.
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private textLayerEl: HTMLElement | null = null;

  // Raster (PDF / page-image) state — driven through the injected RasterSource.
  private rasterDoc: RasterDocument | null = null;
  // Aborts the in-flight render when a newer one supersedes it.
  private renderAbort: AbortController | null = null;

  // Authoritative viewer state.
  private currentPage = 1;
  private scale = 1;
  private rotation: DocumentRotation = 0;
  private tool: DocumentTool = 'select';
  private searchHighlight: SearchHighlightState | null = null;
  private numPages = 0;
  private pageDims: PageDimensions | null = null;
  private unscaledViewport: PageDimensions | null = null;

  // Monotonic token used to discard a stale async load result (a newer load
  // started before this one resolved). Per-render staleness uses `renderAbort`.
  private loadToken = 0;

  // Floor-plan (vector) source. When set, this engine renders a decoded
  // BIMFPLN2 plan instead of a PDF: pages are storey levels, the page box is the
  // STABLE union extent across all levels, and renderActive() emits a synthetic
  // page:rendered (the floor-plan plugin draws the line work off it) rather than
  // running the pdf.js raster path. One engine + one DocumentViewer serve both
  // PDFs and floor plans (the standalone FloorPlanEngine was removed).
  private floorPlanMode = false;
  private floorPlanLevels: FloorPlanLevel[] = [];
  private floorPlanUnionBox: PlanBbox | null = null;

  constructor(private readonly options: DocumentEngineOptions = {}) {}

  /** Wire the DOM nodes and register built-in + user plugins. */
  async mount(elements: MountElements): Promise<void> {
    if (this.container !== null) throw new Error('DocumentEngine already mounted');
    this.container = elements.container;
    this.canvas = elements.canvas;
    this.textLayerEl = elements.textLayer;

    const ctx: DocumentContext = {
      container: elements.container,
      canvas: elements.canvas,
      textLayer: elements.textLayer,
      overlayHost: elements.overlayHost,
      webglHost: elements.webglHost,
      viewportOverlay: elements.viewportOverlay,
      getPageText: (n) => this.rasterDoc?.getPageText?.(n),
      getNumPages: () => this.numPages,
      getCurrentPage: () => this.currentPage,
      getScale: () => this.scale,
      getRotation: () => this.rotation,
      getTool: () => this.tool,
      getPageDimensions: () => this.pageDims,
      getUnscaledViewport: () => this.unscaledViewport,
      setScale: (s) => { this.setScale(s); },
      setRotation: (r) => { this.setRotation(r); },
      setCurrentPage: (n) => { this.setCurrentPage(n); },
      setTool: (t) => { this.setTool(t); },
      setSearchHighlight: (v) => { this.setSearchHighlight(v); },
      events: this.events,
      commands: this.commands,
      plugins: {
        get: <T = unknown>(name: string): T | null =>
          this.pluginManager?.get<T>(name) ?? null,
        has: (name: string) => this.pluginManager?.has(name) ?? false,
      },
    };

    this.pluginManager = new PluginManager(ctx, this.commands, this.events);
    for (const plugin of this.options.plugins ?? []) {
      if (!this.pluginManager) return; // unmount() raced — bail out
      await this.pluginManager.register(plugin);
    }
  }

  // ---- Document lifecycle ----

  async load(fileUrl: string): Promise<void> {
    this.floorPlanMode = false;
    await this.unloadDoc();
    const source = this.options.rasterSource;
    if (source === undefined) {
      this.events.emit('doc:error', {
        error: new Error('DocumentEngine.load() requires a rasterSource'),
      });
      return;
    }
    const token = ++this.loadToken;
    try {
      const doc = await source.open(fileUrl, ({ loaded, total }) => {
        if (token !== this.loadToken) return;
        this.events.emit('doc:progress', { loaded, total });
      });
      if (token !== this.loadToken) {
        await doc.destroy();
        return;
      }
      this.rasterDoc = doc;
      this.numPages = doc.numPages;
      this.events.emit('doc:loaded', { numPages: doc.numPages });
      await this.renderActive();
    } catch (err) {
      if (token !== this.loadToken) return;
      this.events.emit('doc:error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  private async unloadDoc(): Promise<void> {
    if (this.renderAbort !== null) {
      this.renderAbort.abort();
      this.renderAbort = null;
    }
    if (this.rasterDoc !== null) {
      this.rasterDoc.destroy().catch(() => undefined);
      this.rasterDoc = null;
    }
    this.unscaledViewport = null;
    this.pageDims = null;
  }

  /**
   * Load a decoded floor plan as a vector "document": pages are storey levels,
   * the page box is the STABLE union extent across all levels, and there is no
   * raster (renderActive emits a synthetic page:rendered). The floor-plan plugin
   * draws the active level's line work off that event. Synchronous (no
   * network/pdf.js). MUST be called after `mount` so plugins exist to receive
   * the events.
   */
  loadFloorPlan(data: DecodedFloorPlans): void {
    this.floorPlanMode = true;
    this.floorPlanLevels = data.levels;
    this.floorPlanUnionBox = unionBbox(data.levels);
    if (this.floorPlanUnionBox === null) {
      // No geometry — nothing to render.
      this.numPages = 0;
      this.unscaledViewport = null;
      this.pageDims = null;
      this.events.emit('doc:loaded', { numPages: 0 });
      return;
    }
    // The page box == unscaled page box (scale lives in the camera, not a
    // raster). Both report the stable union extent so fit-page math works.
    this.unscaledViewport = {
      width: this.floorPlanUnionBox.maxX - this.floorPlanUnionBox.minX,
      height: this.floorPlanUnionBox.maxY - this.floorPlanUnionBox.minY,
    };
    this.pageDims = this.unscaledViewport;
    this.numPages = this.floorPlanLevels.length;
    this.currentPage = Math.min(Math.max(1, this.currentPage), this.floorPlanLevels.length);
    this.events.emit('doc:loaded', { numPages: this.floorPlanLevels.length });
    this.emitRendered();
  }

  /** Synthetic page:rendered for the active level (floor-plan mode — no raster). */
  private emitRendered(): void {
    if (this.unscaledViewport === null) return;
    this.events.emit('page:rendered', {
      pageNumber: this.currentPage,
      dims: this.unscaledViewport,
      scale: this.scale,
      rotation: this.rotation,
    });
  }

  // ---- State setters (idempotent; render + emit) ----

  setCurrentPage(pageNumber: number): void {
    const max = this.floorPlanMode
      ? (this.numPages || 1)
      : (this.rasterDoc?.numPages ?? Number.MAX_SAFE_INTEGER);
    const safe = Math.min(Math.max(1, pageNumber), max);
    if (safe === this.currentPage) return;
    this.currentPage = safe;
    this.events.emit('page:change', { pageNumber: safe });
    void this.renderActive();
  }

  setScale(scale: number): void {
    const next = clampScale(scale);
    if (next === this.scale) return;
    this.scale = next;
    this.events.emit('scale:change', { scale: next });
    // Floor-plan mode: zoom lives in the camera, there is no raster to re-render.
    if (this.floorPlanMode) return;
    void this.renderActive();
  }

  setRotation(rotation: DocumentRotation): void {
    if (this.floorPlanMode) return; // plans are locked at rotation 0
    if (rotation === this.rotation) return;
    this.rotation = rotation;
    this.events.emit('rotation:change', { rotation });
    void this.renderActive();
  }

  setTool(tool: DocumentTool): void {
    if (tool === this.tool) return;
    this.tool = tool;
    this.events.emit('tool:change', { tool });
  }

  setSearchHighlight(value: SearchHighlightState | null): void {
    this.searchHighlight = value;
    this.events.emit('search:highlight', { highlight: value });
  }

  // ---- Rendering (ported verbatim from the old DocumentViewer effect) ----

  private async renderActive(): Promise<void> {
    // Floor-plan (vector) mode: no raster. Re-emit the synthetic page:rendered
    // the floor-plan plugin redraws off, then bail. Dims are the stable union
    // box, so the camera frame doesn't jump on a level switch.
    if (this.floorPlanMode) {
      this.emitRendered();
      return;
    }
    const doc = this.rasterDoc;
    const canvas = this.canvas;
    const textLayerDiv = this.textLayerEl;
    if (doc === null || canvas === null) return;

    // Supersede any in-flight render.
    if (this.renderAbort !== null) this.renderAbort.abort();
    const abort = new AbortController();
    this.renderAbort = abort;
    const { signal } = abort;

    try {
      const safePage = Math.min(Math.max(1, this.currentPage), doc.numPages);

      // Unscaled (scale=1) viewport so fit-page/fit-width + the canvas-dim
      // clamp work. The engine owns dpr + MAX_CANVAS_DIM policy; the source
      // owns the actual page raster.
      const base = await doc.getPageSize(safePage, this.rotation);
      if (signal.aborted) return;
      this.unscaledViewport = { width: base.width, height: base.height };

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const maxDim = Math.max(base.width, base.height);
      const maxSafeScale = maxDim > 0 ? MAX_CANVAS_DIM / (maxDim * dpr) : this.scale;
      const effectiveScale = Math.min(this.scale, maxSafeScale);

      const rendered = await doc.renderPage(safePage, {
        scale: effectiveScale,
        rotation: this.rotation,
        dpr,
        signal,
      });
      if (signal.aborted) return;
      this.pageDims = { width: rendered.cssW, height: rendered.cssH };

      // Swap: resize the visible canvas and blit the finished frame in one
      // synchronous step — no blank-canvas flash.
      canvas.width = rendered.bufW;
      canvas.height = rendered.bufH;
      canvas.style.width = `${rendered.cssW}px`;
      canvas.style.height = `${rendered.cssH}px`;
      const ctx2d = canvas.getContext('2d');
      ctx2d?.drawImage(rendered.buffer, 0, 0);

      // Emit immediately after the swap so plugins (pdf-underlay) update
      // renderState in sync with the new canvas dimensions.
      this.events.emit('page:rendered', {
        pageNumber: safePage,
        dims: this.pageDims,
        scale: effectiveScale,
        rotation: this.rotation,
      });

      // ---- Selectable text layer (sources that have text — pdf.js) ----
      if (textLayerDiv !== null) {
        textLayerDiv.innerHTML = '';
        if (doc.renderTextLayer !== undefined) {
          await doc.renderTextLayer(safePage, {
            container: textLayerDiv,
            scale: effectiveScale,
            rotation: this.rotation,
            signal,
          });
        }
      }
    } catch (err) {
      if (signal.aborted || err instanceof RasterRenderAborted) return;
      this.events.emit('doc:error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      if (this.renderAbort === abort) this.renderAbort = null;
    }
  }

  async unmount(): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.disposeAll();
      this.pluginManager = null;
    }
    await this.unloadDoc();
    this.floorPlanMode = false;
    this.floorPlanLevels = [];
    this.floorPlanUnionBox = null;
    this.container = null;
    this.canvas = null;
    this.textLayerEl = null;
    this.events.emit('doc:unloaded', undefined);
    this.events.clear();
  }

  async registerPlugin(plugin: DocumentPlugin): Promise<void> {
    if (!this.pluginManager) throw new Error('DocumentEngine is not mounted');
    await this.pluginManager.register(plugin);
  }

  async unregisterPlugin(name: string): Promise<void> {
    if (!this.pluginManager) return;
    await this.pluginManager.unregister(name);
  }

  getPlugin<T = unknown>(name: string): T | null {
    return this.pluginManager?.get<T>(name) ?? null;
  }
}
