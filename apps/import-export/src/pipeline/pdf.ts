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

import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';

import { postCallback } from '../api/callback.js';
import { logger } from '../log.js';
import type { WorkerJob } from '../queue/queue.js';
import { downloadObjectWithHash, pdfMetadataKeyFor, uploadObject } from '../storage/s3.js';

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

// pdfjs-dist in Node.js doesn't use a worker thread; set to empty string to disable.
GlobalWorkerOptions.workerSrc = '';

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

export async function runPdfExtraction(job: WorkerJob): Promise<void> {
  const payload = parsePdfPayload(job.payload);
  const startedAt = new Date().toISOString();
  const version = await getExtractorVersion();

  await postCallback({
    file_id: payload.file_id,
    job_id: job.job_id,
    status: 'running',
    started_at: startedAt,
    extractor_version: version,
  });

  try {
    logger.info({ payload }, 'downloading PDF');
    const { bytes, sha256 } = await downloadObjectWithHash(payload.storage_key);

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

    await postCallback({
      file_id: payload.file_id,
      job_id: job.job_id,
      status: 'succeeded',
      metadata_key: metadataKey,
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
    await postCallback({
      file_id: payload.file_id,
      job_id: job.job_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
    });
    throw err;
  }
}
