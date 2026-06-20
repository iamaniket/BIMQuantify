/**
 * Orchestrates one PDF extraction job:
 *   1. Notify API: running.
 *   2. Download PDF from MinIO.
 *   3. Parse with pdfjs-dist to extract page count + document metadata.
 *   4. Upload metadata.json.
 *   5. Notify API: succeeded (or failed on any thrown error).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDocument, type PDFPageProxy, VerbosityLevel } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { postCallback } from '../api/callback.js';
import { logger } from '../log.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import {
  downloadObjectWithHash,
  pdfGeometryKeyFor,
  pdfMetadataKeyFor,
  uploadObject,
} from '../storage/s3.js';
import { classifyError } from './errors.js';
import { buildPageGeometry, type GeometryArtifact, type PageGeometry } from './pdf-geometry.js';

// pdfjs page access within one document shares state (page cache, xref), so the
// parallelism is kept low — a safe wall-clock win on multi-page docs without
// risking library races. Bump only with measurement on large PDFs.
const PDF_PAGE_CONCURRENCY = 2;

/**
 * Build every page's geometry with bounded concurrency, preserving page order.
 * Each page's pdfjs resources are released via `cleanup()` the moment its
 * geometry is built (peak memory stays ~`concurrency` operator lists, not the
 * whole document). Fail-fast: a throw on any page rejects, mirroring the old
 * serial loop so a bad page still fails the job.
 */
export async function extractPagesConcurrently(
  doc: { getPage: (n: number) => Promise<PDFPageProxy> },
  pageCount: number,
  concurrency: number,
  onPageDone?: (completed: number) => Promise<void> | void,
): Promise<PageGeometry[]> {
  const results = new Array<PageGeometry>(pageCount);
  let nextPage = 1;
  let completed = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const n = nextPage;
      if (n > pageCount) return;
      nextPage += 1;
      const page = await doc.getPage(n);
      try {
        results[n - 1] = await buildPageGeometry(page, n - 1);
      } finally {
        page.cleanup();
      }
      completed += 1;
      await onPageDone?.(completed);
    }
  };
  const lanes = Math.max(1, Math.min(concurrency, pageCount));
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return results;
}

/** Payload shape for `pdf_extraction` jobs. */
export type PdfExtractionPayload = {
  file_id: string;
  project_id: string;
  storage_key: string;
};

function parsePdfPayload(raw: Record<string, unknown>): PdfExtractionPayload {
  const file_id = raw['file_id'];
  const project_id = raw['project_id'];
  const storage_key = raw['storage_key'];
  if (typeof file_id !== 'string' || typeof project_id !== 'string' || typeof storage_key !== 'string') {
    throw new Error(
      `INVALID_PDF_PAYLOAD: expected {file_id, project_id, storage_key} as strings, got ${JSON.stringify(raw)}`,
    );
  }
  return { file_id, project_id, storage_key };
}

// Suppress harmless "getOperatorList - ignoring beginMarkedContentProps"
// warnings from tagged PDFs whose Properties dictionary is absent.
// `setVerbosityLevel` was removed from the named exports in newer pdfjs-dist
// versions but is still accessible on the module namespace object.
import * as _pdfMod from 'pdfjs-dist/legacy/build/pdf.mjs';
{
  const svl = (_pdfMod as Record<string, unknown>)['setVerbosityLevel'];
  if (typeof svl === 'function') (svl as (l: number) => void)(VerbosityLevel.ERRORS);
}

// Worker setup is left to pdfjs-dist: its legacy build's PDFWorker static block
// detects Node.js, disables the real worker thread, and defaults
// GlobalWorkerOptions.workerSrc to "./pdf.worker.mjs" so the worker code runs on
// the main thread. Overriding workerSrc here (e.g. to '') clobbers that default and
// makes getDocument throw `Setting up fake worker failed`. See test/pdf-worker.test.ts.

let cachedVersion: string | null = null;

async function getExtractorVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(here, '..', '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: string };
    cachedVersion = parsed.version ?? '0.0.0';
  } catch {
    cachedVersion = '0.0.0';
  }
  return cachedVersion;
}

export async function runPdfExtraction(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  const payload = parsePdfPayload(job.payload);
  const startedAt = new Date().toISOString();
  const version = await getExtractorVersion();

  const reportProgress = async (pct: number): Promise<void> => {
    await postCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'running',
      started_at: startedAt,
      extractor_version: version,
      progress: pct,
    });
    await onProgress?.(pct);
  };

  await postCallback({
    file_id: payload.file_id,
    organization_id: job.organization_id,
    job_id: job.job_id,
    status: 'running',
    started_at: startedAt,
    extractor_version: version,
  });

  try {
    logger.info({ payload }, 'downloading PDF');
    const { bytes, sha256 } = await downloadObjectWithHash(payload.storage_key);
    await reportProgress(20);

    logger.info({ size: bytes.length, sha256: sha256.slice(0, 16) }, 'parsing PDF');
    const doc = await getDocument({ data: bytes }).promise;
    const pageCount = doc.numPages;
    const metadataResult = await doc.getMetadata();
    const info = metadataResult.info as Record<string, unknown>;

    const metadata = {
      page_count: pageCount,
      title: typeof info['Title'] === 'string' ? info['Title'] : null,
      author: typeof info['Author'] === 'string' ? info['Author'] : null,
      creator: typeof info['Creator'] === 'string' ? info['Creator'] : null,
      creation_date: typeof info['CreationDate'] === 'string' ? info['CreationDate'] : null,
    };

    const metadataKey = pdfMetadataKeyFor(payload.storage_key);
    logger.info({ metadataKey, pageCount }, 'uploading PDF metadata');
    await uploadObject(metadataKey, JSON.stringify(metadata), 'application/json');
    await reportProgress(40);

    // Extract vector geometry + text with bounded page concurrency so we never
    // hold the whole document's operator lists in memory (100s of large PDFs).
    // Per-page progress is mapped onto the 40→90 band so large docs show real
    // movement; pages are reassembled in order inside the helper.
    const pages = await extractPagesConcurrently(doc, pageCount, PDF_PAGE_CONCURRENCY, (done) =>
      reportProgress(40 + Math.round((done / pageCount) * 50)),
    );
    const artifact: GeometryArtifact = { v: 1, p: pages };
    const geometryKey = pdfGeometryKeyFor(payload.storage_key);
    logger.info({ geometryKey, pageCount }, 'uploading PDF geometry');
    await uploadObject(geometryKey, JSON.stringify(artifact), 'application/json');

    await postCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'succeeded',
      metadata_key: metadataKey,
      geometry_key: geometryKey,
      page_count: pageCount,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
      content_sha256: sha256,
    });
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, payload }, 'PDF extraction failed');
    const { retriable, error_kind } = classifyError(err);
    await postCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
      retriable,
      error_kind,
    });
    throw err;
  }
}
