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
  downloadObject,
  fragmentsKeyFor,
  metadataKeyFor,
  propertiesKeyFor,
  uploadObject,
} from '../storage/s3.js';
import { generateFragments } from './fragments.js';
import { closeModel, getIfcApi, openModel, UnsupportedSchemaError } from './ifc.js';
import { buildMetadata } from './metadata.js';
import { buildProperties } from './properties.js';

export type ExtractionJob = {
  file_id: string;
  project_id: string;
  storage_key: string;
};

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

export async function runExtraction(job: ExtractionJob): Promise<void> {
  const startedAt = new Date().toISOString();
  const version = await getExtractorVersion();

  await postCallback({
    file_id: job.file_id,
    status: 'running',
    started_at: startedAt,
    extractor_version: version,
  });

  let modelID: number | null = null;
  try {
    logger.info({ job }, 'downloading source');
    const bytes = await downloadObject(job.storage_key);

    logger.info({ size: bytes.length }, 'parsing IFC');
    const opened = await openModel(bytes);
    modelID = opened.modelID;

    logger.info('generating fragments');
    const fragmentBytes = await generateFragments(bytes);

    logger.info('extracting metadata');
    const ifcApi = await getIfcApi();
    const metadata = await buildMetadata(ifcApi, modelID, opened.schema);

    logger.info('extracting properties');
    const properties = await buildProperties(ifcApi, modelID);

    const fragmentsKey = fragmentsKeyFor(job.storage_key);
    const metadataKey = metadataKeyFor(job.storage_key);
    const propertiesKey = propertiesKeyFor(job.storage_key);

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

    await postCallback({
      file_id: job.file_id,
      status: 'succeeded',
      fragments_key: fragmentsKey,
      metadata_key: metadataKey,
      properties_key: propertiesKey,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
    });
  } catch (err) {
    const message =
      err instanceof UnsupportedSchemaError
        ? err.message
        : err instanceof Error
          ? `${err.name}: ${err.message}`
          : 'UNKNOWN_ERROR';
    logger.error({ err, job }, 'extraction failed');
    await postCallback({
      file_id: job.file_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
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
