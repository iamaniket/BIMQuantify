/**
 * RasterSource — the pdfjs-free abstraction the {@link DocumentEngine} renders a
 * paged raster "document" through. It is the seam that lets ONE engine + one 2D
 * plugin ecosystem run on web (pdf.js, full fidelity + text) AND inside the
 * mobile react-native-webview (server-pre-rendered page images, NO pdfjs in the
 * bundle).
 *
 * The engine owns the orchestration that is identical for every source: the
 * device-pixel-ratio + `MAX_CANVAS_DIM` clamp, the offscreen double-buffer +
 * blit-swap (so the visible canvas never flashes blank), and the
 * `page:rendered` emit. A source owns only the parts that actually differ:
 * producing the page raster and (optionally) selectable text.
 *
 * Implementations:
 * - `PdfjsRasterSource` — wraps pdf.js. The ONLY module importing `pdfjs-dist`.
 * - `ImageRasterSource` — loads a server page-image manifest. pdfjs-free.
 */

import type { DocumentRotation, PageDimensions } from './documentTypes.js';

/** An offscreen page raster + the dimensions the engine needs to blit + size. */
export interface RenderedPage {
  /** Offscreen buffer (device px, `bufW`×`bufH`) the engine blits onto the visible canvas. */
  readonly buffer: CanvasImageSource;
  /** Device-pixel buffer width/height (CSS size × dpr). */
  readonly bufW: number;
  readonly bufH: number;
  /** CSS (layout) width/height of the page at the rendered scale + rotation. */
  readonly cssW: number;
  readonly cssH: number;
}

export interface RenderPageOptions {
  /** Effective scale the engine resolved (already clamped to MAX_CANVAS_DIM). */
  readonly scale: number;
  readonly rotation: DocumentRotation;
  readonly dpr: number;
  /** Aborted when a newer render supersedes this one; sources should bail. */
  readonly signal?: AbortSignal;
}

export interface RenderTextLayerOptions {
  /** The text-layer host element to render selectable spans into. */
  readonly container: HTMLElement;
  readonly scale: number;
  readonly rotation: DocumentRotation;
  readonly signal?: AbortSignal;
}

/** A single opened raster document (one PDF / one image set). */
export interface RasterDocument {
  readonly numPages: number;

  /** Unscaled (scale=1) page size at the given rotation. Drives fit + clamp math. */
  getPageSize(page: number, rotation: DocumentRotation): Promise<PageDimensions>;

  /** Render `page` into an offscreen buffer at `opts.scale`. */
  renderPage(page: number, opts: RenderPageOptions): Promise<RenderedPage>;

  /**
   * Render a selectable text layer over the page (pdf.js). Absent when the
   * source has no text — search + selection then degrade to no-ops.
   */
  renderTextLayer?(page: number, opts: RenderTextLayerOptions): Promise<void>;

  /**
   * Joined lowercased page text for the find scan. Absent when the source has
   * no text (e.g. server image raster without an emitted text sidecar).
   */
  getPageText?(page: number): Promise<string>;

  destroy(): Promise<void>;
}

/** Progress callback shape, mirroring pdf.js `onProgress`. */
export type RasterLoadProgress = (p: { loaded: number; total: number }) => void;

/** Opens a {@link RasterDocument} from a URL. Injected into the engine. */
export interface RasterSource {
  open(url: string, onProgress?: RasterLoadProgress): Promise<RasterDocument>;
}

/** Thrown by a source when a render is aborted (engine treats it as a no-op). */
export class RasterRenderAborted extends Error {
  constructor() {
    super('raster render aborted');
    this.name = 'RasterRenderAborted';
  }
}
