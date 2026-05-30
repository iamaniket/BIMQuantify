/**
 * Orchestrates one DXF/DWG extraction job:
 *   1. Notify API: running.
 *   2. Download the source from MinIO.
 *   3. If DWG, convert to DXF by shelling out to LibreDWG's `dwg2dxf`.
 *   4. Parse the DXF (dxf-parser), build the compact geometry artifact +
 *      a drawing-metadata blob.
 *   5. Upload geometry.json + metadata.json.
 *   6. Notify API: succeeded (or failed on any thrown error).
 *
 * The geometry artifact is byte-compatible with the PDF pipeline's, so the
 * portal's existing vector overlay renders it with no new renderer.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { DxfParser } from 'dxf-parser';

import { postCallback } from '../api/callback.js';
import { getConfig } from '../config.js';
import { logger } from '../log.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import {
  downloadObjectWithHash,
  dxfGeometryKeyFor,
  dxfMetadataKeyFor,
  uploadObject,
} from '../storage/s3.js';
import { buildGeometry, buildMetadata } from './dxf-geometry.js';
import { classifyError, PermanentError } from './errors.js';

const execFileAsync = promisify(execFile);

/** Payload shape for `dxf_extraction` jobs. */
export type DxfExtractionPayload = {
  file_id: string;
  project_id: string;
  storage_key: string;
  source_format: 'dxf' | 'dwg';
};

function parseDxfPayload(raw: Record<string, unknown>): DxfExtractionPayload {
  const file_id = raw['file_id'];
  const project_id = raw['project_id'];
  const storage_key = raw['storage_key'];
  const source_format = raw['source_format'];
  if (
    typeof file_id !== 'string' ||
    typeof project_id !== 'string' ||
    typeof storage_key !== 'string' ||
    (source_format !== 'dxf' && source_format !== 'dwg')
  ) {
    throw new Error(
      `INVALID_DXF_PAYLOAD: expected {file_id, project_id, storage_key, source_format:'dxf'|'dwg'}, got ${JSON.stringify(raw)}`,
    );
  }
  return { file_id, project_id, storage_key, source_format };
}

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

/**
 * Convert DWG bytes to an ASCII DXF string via LibreDWG's `dwg2dxf`
 * (subprocess — no linking against GPL code). Runs in a temp dir that is
 * always cleaned up. A non-zero exit / missing binary surfaces as a permanent
 * failure (re-running won't help a malformed DWG).
 */
async function convertDwgToDxf(bytes: Uint8Array): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'dwg2dxf-'));
  const inPath = path.join(dir, 'input.dwg');
  const outPath = path.join(dir, 'output.dxf');
  try {
    await writeFile(inPath, bytes);
    await execFileAsync('dwg2dxf', ['-y', '-o', outPath, inPath], {
      timeout: getConfig().JOB_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    return await readFile(outPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PermanentError(`DWG_CONVERT_FAILED: ${message}`, 'parse');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function runDxfExtraction(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  const payload = parseDxfPayload(job.payload);
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
    logger.info({ payload }, 'downloading CAD file');
    const { bytes, sha256 } = await downloadObjectWithHash(payload.storage_key);
    await reportProgress(20);

    let dxfText: string;
    if (payload.source_format === 'dwg') {
      logger.info({ size: bytes.length }, 'converting DWG to DXF');
      dxfText = await convertDwgToDxf(bytes);
    } else {
      dxfText = Buffer.from(bytes).toString('utf-8');
    }
    await reportProgress(45);

    logger.info({ sha256: sha256.slice(0, 16) }, 'parsing DXF');
    const dxf = new DxfParser().parseSync(dxfText);
    if (dxf === null) {
      throw new PermanentError('DXF_PARSE_FAILED: parser returned null', 'parse');
    }

    const geometry = buildGeometry(dxf);
    const metadata = buildMetadata(dxf, payload.source_format);
    await reportProgress(70);

    const geometryKey = dxfGeometryKeyFor(payload.storage_key);
    const metadataKey = dxfMetadataKeyFor(payload.storage_key);
    logger.info(
      { geometryKey, metadataKey, lines: geometry.p[0]?.l.length ?? 0 },
      'uploading DXF artifacts',
    );
    await uploadObject(geometryKey, JSON.stringify(geometry), 'application/json');
    await uploadObject(metadataKey, JSON.stringify(metadata), 'application/json');
    await reportProgress(90);

    await postCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'succeeded',
      geometry_key: geometryKey,
      metadata_key: metadataKey,
      page_count: 1,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
      content_sha256: sha256,
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, payload }, 'DXF extraction failed');
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
