/**
 * Orchestrates one `pdf_pages_rasterization` job:
 *   1. Notify API: running.
 *   2. Download PDF from MinIO.
 *   3. Render each page to a WebP image with pdfjs-dist + @napi-rs/canvas.
 *   4. Upload each page image + a `pages.json` manifest.
 *   5. Notify API: succeeded (with the manifest key) or failed.
 *
 * The mobile react-native-webview can't ship pdf.js, so the heavy raster step
 * lives here on the server; the embed's `ImageRasterSource` loads the resulting
 * page images into the shared 2D viewer. This is a SEPARATE job from
 * `pdf_extraction` (metadata + vector geometry) so a heavy/failing raster never
 * jeopardises the fast extraction path and can be retried independently.
 *
 * pdf.js v4 already integrates @napi-rs/canvas in Node: it instantiates the
 * canvas + the glyph `Path2D` from that package. We therefore render through
 * pdf.js's OWN `doc.canvasFactory` (a single @napi-rs/canvas instance) rather
 * than creating canvases ourselves — mixing a second @napi-rs import made pdf.js
 * hand the context a Path2D it rejected.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

import type { Canvas, SKRSContext2D } from '@napi-rs/canvas';
import { getDocument, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { postPagesCallback } from '../api/pagesCallback.js';
import { getConfig } from '../config.js';
import { logger } from '../log.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import {
  downloadObject,
  pdfPageImageKeyFor,
  pdfPagesManifestKeyFor,
  uploadObject,
} from '../storage/s3.js';
import { classifyError } from './errors.js';

// pdf.js renders glyphs as paths in Node (no FontFace). For that it must load
// the standard-14 font programs + CMaps it ships with; its Node factories read
// these straight off the filesystem (fs.readFile), so we hand it absolute paths
// (trailing separator — pdf.js concatenates `baseUrl + filename`).
const require = createRequire(import.meta.url);
const PDFJS_DIR = path.resolve(path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')), '..', '..');
const STANDARD_FONT_DATA_URL = path.join(PDFJS_DIR, 'standard_fonts') + path.sep;
const CMAP_URL = path.join(PDFJS_DIR, 'cmaps') + path.sep;

/** One rendered page: PDF point size + native image size + WebP bytes. */
export interface RasterizedPage {
  index: number;
  /** PDF page size in points (scale=1) — the world-space page box for the viewer. */
  pageWidth: number;
  pageHeight: number;
  /** Native rendered pixel size of the WebP. */
  imageWidth: number;
  imageHeight: number;
  webp: Buffer;
}

export interface RasterizeOptions {
  dpi: number;
  maxEdgePx: number;
  /** WebP quality 0–100. */
  quality: number;
  concurrency: number;
}

/** The shape of pdf.js's `doc.canvasFactory` (typed as `Object` by pdf.js). */
interface CanvasAndContext {
  canvas: Canvas;
  context: SKRSContext2D;
}
interface PdfCanvasFactory {
  create(width: number, height: number): CanvasAndContext;
  destroy(cc: { canvas: Canvas | null; context: SKRSContext2D | null }): void;
}

type RenderParams = Parameters<PDFPageProxy['render']>[0];

async function renderOne(
  page: PDFPageProxy,
  factory: PdfCanvasFactory,
  pageNumber: number,
  opts: RasterizeOptions,
): Promise<RasterizedPage> {
  const base = page.getViewport({ scale: 1 });
  const longEdge = Math.max(base.width, base.height);
  // Target DPI, but never let the long edge exceed the cap.
  let scale = opts.dpi / 72;
  if (longEdge > 0 && longEdge * scale > opts.maxEdgePx) {
    scale = opts.maxEdgePx / longEdge;
  }
  const viewport = page.getViewport({ scale });
  const cc = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await page.render({
      // @napi-rs context cast through pdf.js's own render-param type (the
      // processor tsconfig has no DOM lib to name `CanvasRenderingContext2D`).
      canvasContext: cc.context as unknown as RenderParams['canvasContext'],
      viewport,
    }).promise;
    const webp = await cc.canvas.encode('webp', opts.quality);
    return {
      index: pageNumber - 1,
      pageWidth: base.width,
      pageHeight: base.height,
      imageWidth: cc.canvas.width,
      imageHeight: cc.canvas.height,
      webp,
    };
  } finally {
    factory.destroy(cc);
  }
}

/**
 * Render every page of `bytes` to a WebP image with bounded concurrency,
 * preserving page order. Each page's pdfjs resources are released the moment its
 * image is encoded, so peak memory stays ~`concurrency` canvases (not the whole
 * document). Pure (no S3) so it is unit-testable against an in-memory PDF.
 */
export async function renderPdfPages(
  bytes: Uint8Array,
  opts: RasterizeOptions,
  onPageDone?: (completed: number, total: number) => Promise<void> | void,
): Promise<RasterizedPage[]> {
  const doc = await getDocument({
    data: bytes,
    // No FontFace in Node — render glyphs as paths, with the standard fonts +
    // CMaps loaded off disk so the outlines actually resolve.
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
  }).promise;
  // pdf.js's own @napi-rs/canvas factory — using it (rather than a second
  // @napi-rs import) keeps the canvas, context, and glyph Path2D in one instance.
  const factory = doc.canvasFactory as unknown as PdfCanvasFactory;
  try {
    const total: number = doc.numPages;
    const out = new Array<RasterizedPage>(total);
    let next = 1;
    let completed = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        const n = next;
        if (n > total) return;
        next += 1;
        const page = await doc.getPage(n);
        try {
          out[n - 1] = await renderOne(page, factory, n, opts);
        } finally {
          page.cleanup();
        }
        completed += 1;
        await onPageDone?.(completed, total);
      }
    };
    const lanes = Math.max(1, Math.min(opts.concurrency, total));
    await Promise.all(Array.from({ length: lanes }, () => worker()));
    return out;
  } finally {
    await doc.destroy();
  }
}

/** Payload shape for `pdf_pages_rasterization` jobs. */
export type PdfRasterizePayload = {
  file_id: string;
  project_id: string;
  storage_key: string;
};

function parsePayload(raw: Record<string, unknown>): PdfRasterizePayload {
  const file_id = raw['file_id'];
  const project_id = raw['project_id'];
  const storage_key = raw['storage_key'];
  if (typeof file_id !== 'string' || typeof project_id !== 'string' || typeof storage_key !== 'string') {
    throw new Error(
      `INVALID_PDF_RASTERIZE_PAYLOAD: expected {file_id, project_id, storage_key} as strings, got ${JSON.stringify(raw)}`,
    );
  }
  return { file_id, project_id, storage_key };
}

export async function runPdfPagesRasterization(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  const cfg = getConfig();
  const payload = parsePayload(job.payload);
  const startedAt = new Date().toISOString();

  const report = async (pct: number): Promise<void> => {
    await postPagesCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'running',
      started_at: startedAt,
      progress: pct,
    });
    await onProgress?.(pct);
  };

  await report(0);

  try {
    logger.info({ payload }, 'downloading PDF for rasterization');
    const bytes = await downloadObject(payload.storage_key);
    await report(15);

    const opts: RasterizeOptions = {
      dpi: cfg.JOB_PDF_RASTER_DPI,
      maxEdgePx: cfg.JOB_PDF_RASTER_MAX_EDGE_PX,
      quality: cfg.JOB_PDF_RASTER_QUALITY,
      concurrency: cfg.JOB_PDF_RASTER_CONCURRENCY,
    };

    // Per-page progress mapped onto the 15→85 band so large docs show movement.
    const pages = await renderPdfPages(bytes, opts, (done, total) =>
      report(15 + Math.round((done / total) * 70)),
    );

    // Upload page images, then build the manifest carrying their keys.
    const manifestPages = await Promise.all(
      pages.map(async (p) => {
        const key = pdfPageImageKeyFor(payload.storage_key, p.index);
        await uploadObject(key, p.webp, 'image/webp');
        return {
          index: p.index,
          pageWidth: p.pageWidth,
          pageHeight: p.pageHeight,
          imageWidth: p.imageWidth,
          imageHeight: p.imageHeight,
          // S3 object key — the API presigns each at viewer-bundle time.
          key,
        };
      }),
    );

    const manifest = { v: 1, pages: manifestPages };
    const manifestKey = pdfPagesManifestKeyFor(payload.storage_key);
    logger.info({ manifestKey, pageCount: pages.length }, 'uploading PDF pages manifest');
    await uploadObject(manifestKey, JSON.stringify(manifest), 'application/json');

    await postPagesCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'succeeded',
      pdf_pages_key: manifestKey,
      page_count: pages.length,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, payload }, 'PDF rasterization failed');
    const { retriable, error_kind } = classifyError(err);
    await postPagesCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      retriable,
      error_kind,
    });
    throw err;
  }
}
