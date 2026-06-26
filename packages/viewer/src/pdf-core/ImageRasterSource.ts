/**
 * ImageRasterSource — a pdfjs-free {@link RasterSource} that renders a PDF from
 * server-pre-rendered page images (one WebP per page) described by a manifest.
 * The mobile react-native-webview uses this instead of pdf.js: the same
 * `DocumentEngine` + 2D plugin ecosystem runs, but the page raster comes from an
 * image draw rather than an on-device pdf.js render — so the embed bundle never
 * ships pdf.js.
 *
 * The manifest gives each page's PDF point size (the world-space page box, kept
 * consistent with the pdf.js path) and the image's native pixel size + URL:
 *
 *   { "pages": [ { "index": 0, "pageWidth": 595.3, "pageHeight": 841.9,
 *                  "imageWidth": 2480, "imageHeight": 3508, "url": "…" }, … ] }
 *
 * URLs may be presigned http(s) (online) or `file://` (offline-pinned). Images
 * are drawn display-only (never read back), so cross-origin tainting is fine.
 */

import type { DocumentRotation } from './documentTypes.js';
import {
  RasterRenderAborted,
  type RasterDocument,
  type RasterLoadProgress,
  type RasterSource,
  type RenderPageOptions,
  type RenderedPage,
} from './rasterSource.js';

interface RasterPageEntry {
  index: number;
  /** PDF page size in points (scale=1, unrotated) — the world-space page box. */
  pageWidth: number;
  pageHeight: number;
  /** Native pixel size of the rendered image. */
  imageWidth: number;
  imageHeight: number;
  url: string;
}

interface RasterManifest {
  pages: RasterPageEntry[];
}

function isLandscapeSwap(rotation: DocumentRotation): boolean {
  return rotation === 90 || rotation === 270;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load page image: ${url}`));
    img.src = url;
  });
}

class ImageRasterDocument implements RasterDocument {
  private readonly images = new Map<number, HTMLImageElement>();

  constructor(private readonly pages: RasterPageEntry[]) {}

  get numPages(): number {
    return this.pages.length;
  }

  private entry(n: number): RasterPageEntry {
    const e = this.pages[n - 1];
    if (e === undefined) throw new Error(`No raster page ${String(n)} (have ${String(this.pages.length)})`);
    return e;
  }

  private async image(n: number): Promise<HTMLImageElement> {
    const cached = this.images.get(n);
    if (cached !== undefined) return cached;
    const img = await loadImage(this.entry(n).url);
    this.images.set(n, img);
    return img;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getPageSize(n: number, rotation: DocumentRotation): Promise<{ width: number; height: number }> {
    const e = this.entry(n);
    return isLandscapeSwap(rotation)
      ? { width: e.pageHeight, height: e.pageWidth }
      : { width: e.pageWidth, height: e.pageHeight };
  }

  async renderPage(n: number, opts: RenderPageOptions): Promise<RenderedPage> {
    const img = await this.image(n);
    if (opts.signal?.aborted) throw new RasterRenderAborted();

    const size = await this.getPageSize(n, opts.rotation);
    const cssW = Math.floor(size.width * opts.scale);
    const cssH = Math.floor(size.height * opts.scale);
    const bufW = Math.floor(cssW * opts.dpr);
    const bufH = Math.floor(cssH * opts.dpr);

    const offscreen = document.createElement('canvas');
    offscreen.width = bufW;
    offscreen.height = bufH;
    const c = offscreen.getContext('2d');
    if (c === null) throw new Error(`Canvas context unavailable (${String(bufW)}×${String(bufH)}px)`);
    c.imageSmoothingQuality = 'high';

    // Draw the native image into the buffer, honoring rotation. The image is
    // always stored upright (rotation 0); we rotate around the buffer center.
    c.save();
    c.translate(bufW / 2, bufH / 2);
    c.rotate((opts.rotation * Math.PI) / 180);
    // After rotating, the unrotated draw box is the non-swapped css×dpr extent.
    const drawW = isLandscapeSwap(opts.rotation) ? bufH : bufW;
    const drawH = isLandscapeSwap(opts.rotation) ? bufW : bufH;
    c.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    c.restore();

    return { buffer: offscreen, bufW, bufH, cssW, cssH };
  }

  // No text layer / search for image sources — search degrades to a no-op.

  // eslint-disable-next-line @typescript-eslint/require-await
  async destroy(): Promise<void> {
    this.images.clear();
  }
}

/**
 * Server page-image raster source. Injected by the mobile embed for PDFs:
 * `<DocumentViewer fileUrl={manifestUrl} rasterSource={imageRasterSource} />`.
 * `open(url)` fetches the manifest JSON; page images load lazily on first draw.
 */
export const imageRasterSource: RasterSource = {
  async open(manifestUrl: string, onProgress?: RasterLoadProgress): Promise<RasterDocument> {
    const res = await fetch(manifestUrl);
    if (!res.ok) throw new Error(`Failed to fetch page manifest (${String(res.status)})`);
    const manifest = (await res.json()) as RasterManifest;
    const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
    if (pages.length === 0) throw new Error('Page manifest has no pages');
    // Coarse progress: manifest fetched (pages stream in lazily afterwards).
    onProgress?.({ loaded: 1, total: 1 });
    return new ImageRasterDocument(pages);
  },
};
