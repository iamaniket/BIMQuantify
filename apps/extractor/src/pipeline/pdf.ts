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
import { downloadObject, pdfMetadataKeyFor, uploadObject } from '../storage/s3.js';
import type { ExtractionJob } from './extract.js';

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

export async function runPdfExtraction(job: ExtractionJob): Promise<void> {
  const startedAt = new Date().toISOString();
  const version = await getExtractorVersion();

  await postCallback({
    file_id: job.file_id,
    job_id: job.job_id,
    status: 'running',
    started_at: startedAt,
    extractor_version: version,
  });

  try {
    logger.info({ job }, 'downloading PDF');
    const bytes = await downloadObject(job.storage_key);

    logger.info({ size: bytes.length }, 'parsing PDF');
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

    const metadataKey = pdfMetadataKeyFor(job.storage_key);
    logger.info({ metadataKey, pageCount }, 'uploading PDF metadata');
    await uploadObject(metadataKey, JSON.stringify(metadata), 'application/json');

    await postCallback({
      file_id: job.file_id,
      job_id: job.job_id,
      status: 'succeeded',
      metadata_key: metadataKey,
      page_count: pageCount,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
    });
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, job }, 'PDF extraction failed');
    await postCallback({
      file_id: job.file_id,
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
