/**
 * PdfjsRasterSource — the pdf.js implementation of {@link RasterSource}. This is
 * the ONLY module in the package that imports `pdfjs-dist`, so any entry point
 * (e.g. `./viewer-2d`) that does not reference it stays pdfjs-free and never
 * pulls the ~1.25 MB worker into its bundle.
 *
 * All of this code was lifted verbatim out of the old `DocumentEngine` PDF path
 * (load + page raster + TextLayer); the engine now drives it through the
 * source-agnostic interface.
 */

import * as pdfjsLib from 'pdfjs-dist';

import type { DocumentRotation } from './documentTypes.js';
import {
  RasterRenderAborted,
  type RasterDocument,
  type RasterLoadProgress,
  type RasterSource,
  type RenderPageOptions,
  type RenderTextLayerOptions,
  type RenderedPage,
} from './rasterSource.js';

// Configure the pdf.js worker once at module load — same setup the old
// monolithic DocumentViewer used. Lives here (not in DocumentEngine) so the
// engine carries no pdfjs reference.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type PdfTextContent = Awaited<ReturnType<pdfjsLib.PDFPageProxy['getTextContent']>>;

class PdfjsRasterDocument implements RasterDocument {
  // The currently-held page (for size + raster of the active page). Search uses
  // doc.getPage directly so it never evicts this one.
  private activePage: pdfjsLib.PDFPageProxy | null = null;
  private activePageNumber = -1;
  private renderTask: pdfjsLib.RenderTask | null = null;
  private textLayerInstance: pdfjsLib.TextLayer | null = null;
  private readonly textContentCache = new Map<number, PdfTextContent>();

  constructor(private readonly doc: pdfjsLib.PDFDocumentProxy) {}

  get numPages(): number {
    return this.doc.numPages;
  }

  private async page(n: number): Promise<pdfjsLib.PDFPageProxy> {
    if (this.activePageNumber === n && this.activePage !== null) return this.activePage;
    if (this.activePage !== null) this.activePage.cleanup();
    const p = await this.doc.getPage(n);
    this.activePage = p;
    this.activePageNumber = n;
    return p;
  }

  async getPageSize(n: number, rotation: DocumentRotation): Promise<{ width: number; height: number }> {
    const p = await this.page(n);
    const base = p.getViewport({ scale: 1, rotation });
    return { width: base.width, height: base.height };
  }

  async renderPage(n: number, opts: RenderPageOptions): Promise<RenderedPage> {
    if (this.renderTask !== null) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    const p = await this.page(n);
    if (opts.signal?.aborted) throw new RasterRenderAborted();

    const viewport = p.getViewport({ scale: opts.scale, rotation: opts.rotation });
    const bufW = Math.floor(viewport.width * opts.dpr);
    const bufH = Math.floor(viewport.height * opts.dpr);
    const cssW = Math.floor(viewport.width);
    const cssH = Math.floor(viewport.height);

    // Render to an offscreen buffer so the engine keeps old content until the
    // new frame is ready (avoids blank-canvas flash on the visible canvas).
    const offscreen = document.createElement('canvas');
    offscreen.width = bufW;
    offscreen.height = bufH;
    const offCtx = offscreen.getContext('2d');
    if (offCtx === null) {
      throw new Error(`Canvas context unavailable (${bufW}×${bufH}px)`);
    }

    const task = p.render({
      canvasContext: offCtx,
      canvas: offscreen,
      viewport,
      transform: opts.dpr !== 1 ? [opts.dpr, 0, 0, opts.dpr, 0, 0] : undefined,
    });
    this.renderTask = task;
    const onAbort = (): void => { task.cancel(); };
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await task.promise;
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (opts.signal?.aborted || name === 'RenderingCancelledException') {
        throw new RasterRenderAborted();
      }
      throw err;
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
      if (this.renderTask === task) this.renderTask = null;
    }

    return { buffer: offscreen, bufW, bufH, cssW, cssH };
  }

  async renderTextLayer(n: number, opts: RenderTextLayerOptions): Promise<void> {
    if (this.textLayerInstance !== null) {
      this.textLayerInstance.cancel();
      this.textLayerInstance = null;
    }
    const p = await this.page(n);
    if (opts.signal?.aborted) return;

    const viewport = p.getViewport({ scale: opts.scale, rotation: opts.rotation });
    opts.container.style.setProperty('--scale-factor', String(opts.scale));

    let textContent = this.textContentCache.get(n);
    if (textContent === undefined) {
      textContent = await p.getTextContent();
      if (opts.signal?.aborted) return;
      this.textContentCache.set(n, textContent);
    }

    const tl = new pdfjsLib.TextLayer({
      textContentSource: textContent,
      container: opts.container,
      viewport,
    });
    this.textLayerInstance = tl;
    await tl.render();
  }

  async getPageText(n: number): Promise<string> {
    let textContent = this.textContentCache.get(n);
    if (textContent === undefined) {
      // Fetch directly off the doc so the search scan never evicts the active
      // (visible) page held by `this.page`.
      const p = await this.doc.getPage(n);
      textContent = await p.getTextContent();
      this.textContentCache.set(n, textContent);
    }
    return textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .toLowerCase();
  }

  async destroy(): Promise<void> {
    if (this.renderTask !== null) {
      this.renderTask.cancel();
      this.renderTask = null;
    }
    if (this.textLayerInstance !== null) {
      this.textLayerInstance.cancel();
      this.textLayerInstance = null;
    }
    if (this.activePage !== null) {
      this.activePage.cleanup();
      this.activePage = null;
    }
    this.textContentCache.clear();
    await this.doc.destroy().catch(() => undefined);
  }
}

/** The pdf.js-backed raster source. Injected by the web (`DocumentViewer`). */
export const pdfjsRasterSource: RasterSource = {
  async open(url: string, onProgress?: RasterLoadProgress): Promise<RasterDocument> {
    const task = pdfjsLib.getDocument({
      url,
      disableAutoFetch: true,
      disableStream: false,
      verbosity: pdfjsLib.VerbosityLevel.ERRORS,
    });
    if (onProgress !== undefined) {
      task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
        onProgress({ loaded, total });
      };
    }
    const doc = await task.promise;
    return new PdfjsRasterDocument(doc);
  },
};
