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

import * as pdfjsLib from 'pdfjs-dist';


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

// Configure the pdf.js worker once at module load — same setup the old
// monolithic DocumentViewer used.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();



type PdfTextContent = Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>;

interface DocumentEngineOptions {
  /** Plugins to register at mount. Order matters for dependencies. */
  plugins?: DocumentPlugin[];
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

  // pdf.js state.
  private doc: pdfjsLib.PDFDocumentProxy | null = null;
  private page: pdfjsLib.PDFPageProxy | null = null;
  private renderTask: pdfjsLib.RenderTask | null = null;
  private textLayerInstance: pdfjsLib.TextLayer | null = null;
  private readonly textContentCache = new Map<number, PdfTextContent>();

  // Authoritative viewer state.
  private currentPage = 1;
  private scale = 1;
  private rotation: DocumentRotation = 0;
  private tool: DocumentTool = 'select';
  private searchHighlight: SearchHighlightState | null = null;
  private numPages = 0;
  private pageDims: PageDimensions | null = null;
  private unscaledViewport: PageDimensions | null = null;

  // Monotonic tokens used to discard stale async load/render results.
  private loadToken = 0;
  private renderToken = 0;

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
      getDocument: () => this.doc,
      getPage: () => this.page,
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
    await this.unloadDoc();
    const token = ++this.loadToken;
    try {
      const task = pdfjsLib.getDocument({
        url: fileUrl,
        disableAutoFetch: true,
        disableStream: false,
        verbosity: pdfjsLib.VerbosityLevel.ERRORS,
      });
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        if (token !== this.loadToken) return;
        this.events.emit('doc:progress', { loaded, total });
      };
      const newDoc = await task.promise;
      if (token !== this.loadToken) {
        await newDoc.destroy();
        return;
      }
      this.doc = newDoc;
      this.numPages = newDoc.numPages;
      this.textContentCache.clear();
      this.events.emit('doc:loaded', { numPages: newDoc.numPages });
      await this.renderActive();
    } catch (err) {
      if (token !== this.loadToken) return;
      this.events.emit('doc:error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  private async unloadDoc(): Promise<void> {
    if (this.renderTask !== null) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    if (this.textLayerInstance !== null) {
      this.textLayerInstance.cancel();
      this.textLayerInstance = null;
    }
    if (this.page !== null) {
      this.page.cleanup();
      this.page = null;
    }
    if (this.doc !== null) {
      this.doc.destroy().catch(() => undefined);
      this.doc = null;
    }
    this.textContentCache.clear();
    this.unscaledViewport = null;
    this.pageDims = null;
  }

  // ---- State setters (idempotent; render + emit) ----

  setCurrentPage(pageNumber: number): void {
    const max = this.doc?.numPages ?? Number.MAX_SAFE_INTEGER;
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
    void this.renderActive();
  }

  setRotation(rotation: DocumentRotation): void {
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
    const doc = this.doc;
    const canvas = this.canvas;
    const textLayerDiv = this.textLayerEl;
    if (doc === null || canvas === null) return;

    const token = ++this.renderToken;
    const cancelled = (): boolean => token !== this.renderToken;

    if (this.renderTask !== null) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    if (this.textLayerInstance !== null) {
      this.textLayerInstance.cancel();
      this.textLayerInstance = null;
    }
    if (this.page !== null) {
      this.page.cleanup();
      this.page = null;
    }

    try {
      const safePage = Math.min(Math.max(1, this.currentPage), doc.numPages);
      const page = await doc.getPage(safePage);
      if (cancelled()) {
        page.cleanup();
        return;
      }
      this.page = page;

      // Track the unscaled viewport so fit-page/fit-width math works.
      const base = page.getViewport({ scale: 1, rotation: this.rotation });
      this.unscaledViewport = { width: base.width, height: base.height };

      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const maxDim = Math.max(base.width, base.height);
      const maxSafeScale = maxDim > 0
        ? MAX_CANVAS_DIM / (maxDim * dpr)
        : this.scale;
      const effectiveScale = Math.min(this.scale, maxSafeScale);

      const viewport = page.getViewport({ scale: effectiveScale, rotation: this.rotation });
      const bufW = Math.floor(viewport.width * dpr);
      const bufH = Math.floor(viewport.height * dpr);
      const cssW = Math.floor(viewport.width);
      const cssH = Math.floor(viewport.height);
      this.pageDims = { width: cssW, height: cssH };

      // Render to an offscreen buffer so the visible canvas keeps its old
      // content until the new frame is ready (avoids blank-canvas flash).
      const offscreen = document.createElement('canvas');
      offscreen.width = bufW;
      offscreen.height = bufH;
      const offCtx = offscreen.getContext('2d');
      if (offCtx === null) {
        this.events.emit('doc:error', {
          error: new Error(`Canvas context unavailable (${bufW}×${bufH}px)`),
        });
        return;
      }

      const task = page.render({
        canvasContext: offCtx,
        canvas: offscreen,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      this.renderTask = task;
      await task.promise;
      if (this.renderTask === task) {
        this.renderTask = null;
      }

      // Swap: resize visible canvas and blit the finished frame in one
      // synchronous step — no blank-canvas flash.
      if (!cancelled()) {
        canvas.width = bufW;
        canvas.height = bufH;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        const ctx2d = canvas.getContext('2d');
        ctx2d?.drawImage(offscreen, 0, 0);

        // Emit immediately after the swap so plugins (pdf-underlay) update
        // renderState in sync with the new canvas dimensions.
        this.events.emit('page:rendered', {
          pageNumber: safePage,
          dims: this.pageDims!,
          scale: effectiveScale,
          rotation: this.rotation,
        });
      }

      // ---- Render TextLayer over the canvas ----
      if (textLayerDiv !== null && !cancelled()) {
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.setProperty('--scale-factor', String(effectiveScale));

        let textContent = this.textContentCache.get(safePage);
        if (textContent === undefined) {
          textContent = await page.getTextContent();
          if (cancelled()) return;
          this.textContentCache.set(safePage, textContent);
        }

        const tl = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        this.textLayerInstance = tl;
        await tl.render();
      }
    } catch (err) {
      if (cancelled()) return;
      const e = err as { name?: string };
      if (e?.name === 'RenderingCancelledException') return;
      this.events.emit('doc:error', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  async unmount(): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.disposeAll();
      this.pluginManager = null;
    }
    await this.unloadDoc();
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
