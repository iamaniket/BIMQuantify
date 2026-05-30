/**
 * Orchestrates one extraction job:
 *   1. Notify API: running.
 *   2. Download .ifc from MinIO.
 *   3. Parse with web-ifc, gate on supported schema.
 *   4. Generate fragments via @thatopen/fragments.
 *   5. Walk model for metadata + properties.
 *   6. Upload .frag, metadata.json, properties.json.
 *   7. Notify API: succeeded (or failed on any thrown error).
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postCallback } from '../api/callback.js';
import { logger } from '../log.js';
import {
  downloadObjectWithHash,
  fragmentsKeyFor,
  metadataKeyFor,
  propertiesKeyFor,
  uploadObject,
} from '../storage/s3.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import { classifyError } from './errors.js';
import { generateFragments } from './fragments.js';
import { closeModel, getIfcApi, openModel, UnsupportedSchemaError } from './ifc.js';
import { buildMetadata } from './metadata.js';
import { buildProperties } from './properties.js';
import { extractIfcFromZip } from './unzip.js';

/** Payload shape for `ifc_extraction` jobs. The API populates this when
 * dispatching; the worker reads it via `job.payload`. `compressed` flags an
 * ifcZIP upload — the stored object is a zip wrapping the `.ifc`, so the bytes
 * must be unzipped before parsing. */
export type IfcExtractionPayload = {
  file_id: string;
  project_id: string;
  storage_key: string;
  compressed: boolean;
};

function parseIfcPayload(raw: Record<string, unknown>): IfcExtractionPayload {
  const file_id = raw['file_id'];
  const project_id = raw['project_id'];
  const storage_key = raw['storage_key'];
  if (typeof file_id !== 'string' || typeof project_id !== 'string' || typeof storage_key !== 'string') {
    throw new Error(
      `INVALID_IFC_PAYLOAD: expected {file_id, project_id, storage_key} as strings, got ${JSON.stringify(raw)}`,
    );
  }
  return { file_id, project_id, storage_key, compressed: raw['compressed'] === true };
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

export async function runExtraction(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  const payload = parseIfcPayload(job.payload);
  const startedAt = new Date().toISOString();
  const startedAtMs = performance.now();
  const version = await getExtractorVersion();

  // Posts a `running` callback carrying `progress` and mirrors it to BullMQ.
  // Progress surfaces in the portal via the Job row (polled), not a per-tick
  // notification — see the callback handler's emit gate.
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

  let modelID: number | null = null;
  try {
    logger.info({ payload }, 'downloading source');
    const { bytes, sha256 } = await downloadObjectWithHash(payload.storage_key);
    await reportProgress(10);

    // For an ifcZIP the stored object is the zip; unwrap to the inner IFC
    // before parsing. `sha256` stays the hash of the stored (compressed) bytes
    // — that's what the client uploaded and what dedup keys on.
    const ifcBytes = payload.compressed ? extractIfcFromZip(bytes) : bytes;

    logger.info({ size: ifcBytes.length, sha256: sha256.slice(0, 16) }, 'parsing IFC');
    const opened = await openModel(ifcBytes);
    modelID = opened.modelID;
    await reportProgress(40);

    logger.info('generating fragments');
    const fragmentBytes = await generateFragments(ifcBytes);
    await reportProgress(80);

    logger.info('extracting metadata');
    const ifcApi = await getIfcApi();
    const metadata = await buildMetadata(ifcApi, modelID, opened.schema);

    logger.info('extracting properties');
    const properties = await buildProperties(ifcApi, modelID, metadata.elements);

    const fragmentsKey = fragmentsKeyFor(payload.storage_key);
    const metadataKey = metadataKeyFor(payload.storage_key);
    const propertiesKey = propertiesKeyFor(payload.storage_key);

    logger.info({ fragmentsKey, metadataKey, propertiesKey }, 'uploading outputs');
    await Promise.all([
      uploadObject(fragmentsKey, fragmentBytes, 'application/octet-stream'),
      uploadObject(
        metadataKey,
        JSON.stringify(metadata),
        'application/json',
      ),
      uploadObject(
        propertiesKey,
        JSON.stringify(properties),
        'application/json',
      ),
    ]);

    const elapsedMs = Math.round(performance.now() - startedAtMs);
    logger.info(
      { file_id: payload.file_id, job_id: job.job_id, elapsed_ms: elapsedMs },
      `extraction finished in ${elapsedMs}ms`,
    );

    await postCallback({
      file_id: payload.file_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'succeeded',
      fragments_key: fragmentsKey,
      metadata_key: metadataKey,
      properties_key: propertiesKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
      content_sha256: sha256,
      ifc_project_guid: metadata.project.globalId ?? undefined,
    });
  } catch (err) {
    const message =
      err instanceof UnsupportedSchemaError
        ? err.message
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : 'UNKNOWN_ERROR';
    logger.error({ err, payload }, 'extraction failed');
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
  } finally {
    if (modelID !== null) {
      try {
        await closeModel(modelID);
      } catch (closeErr) {
        logger.warn({ err: closeErr }, 'closeModel failed');
      }
    }
  }
}
