/**
 * Orchestrates one extraction job:
 *   1. Notify API: running.
 *   2. Download .ifc from MinIO (sha256 is of the stored bytes).
 *   3. Spawn two worker threads (worker-host.ts / extraction-worker.ts) so the
 *      fragments pipeline and the web-ifc walk run on separate cores instead
 *      of time-slicing one event loop:
 *        - 'frag-outline': IFC → .frag bytes, then the hard-edge outline
 *          artifact (computed headless from the fragments).
 *        - 'walk': parse + schema gate, then metadata + properties.
 *   4. Pipelined uploads — each artifact uploads the moment its worker message
 *      arrives (.frag, .outline.bin, metadata.json, properties.json).
 *   5. Notify API: succeeded (or failed on any thrown error).
 *
 * Outline failure degrades gracefully: the job still succeeds without
 * `outline_key` and the viewer falls back to its client-side edge compute.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { postCallback } from '../api/callback.js';
import { logger } from '../log.js';
import {
  downloadObjectWithHash,
  floorPlansKeyFor,
  fragmentsKeyFor,
  metadataKeyFor,
  outlineKeyFor,
  propertiesKeyFor,
  uploadObject,
} from '../storage/s3.js';
import type { ProgressReporter, WorkerJob } from '../queue/queue.js';
import { classifyError } from './errors.js';
import { UnsupportedSchemaError } from './ifc.js';
import type { StoreyInfo } from './metadata.js';
import { time } from './timing.js';
import { extractIfcFromZip } from './unzip.js';
import { type ExtractionWorkerHandle, startExtractionWorker } from './worker-host.js';

/** Payload shape for `ifc_extraction` jobs. The API populates this when
 * dispatching; the worker reads it via `job.payload`. `compressed` flags an
 * ifcZIP upload — the stored object is a zip wrapping the `.ifc`, so the bytes
 * must be unzipped before parsing. */
export type IfcExtractionPayload = {
  file_id: string;
  project_id: string;
  storage_key: string;
  compressed: boolean;
  // The parent Document's user-declared discipline (architectural | structural |
  // mep | coordination | other), when the API supplies it. Drives the floor-plan
  // gate (classify.ts::shouldGenerateFloorPlan); absent → content auto-detect.
  discipline?: string;
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
  const discipline = raw['discipline'];
  return {
    file_id,
    project_id,
    storage_key,
    compressed: raw['compressed'] === true,
    ...(typeof discipline === 'string' ? { discipline } : {}),
  };
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

  // Per-stage wall-clock, logged as one `stage complete` line each, so the real
  // breakdown is in the logs instead of inferred from start-of-stage gaps. The
  // metadata/properties walks additionally log their own sub-step breakdowns
  // (from inside the walk worker thread).
  const logStage = (stage: string, ms: number): void => {
    logger.info({ stage, ms, file_id: payload.file_id, job_id: job.job_id }, 'stage complete');
  };

  try {
    logger.info({ payload }, 'downloading source');
    const download = await time(() => downloadObjectWithHash(payload.storage_key));
    const { bytes, sha256 } = download.result;
    logStage('download', download.ms);
    await reportProgress(10);

    // For an ifcZIP the stored object is the zip; unwrap to the inner IFC
    // before parsing. `sha256` stays the hash of the stored (compressed) bytes
    // — that's what the client uploaded and what dedup keys on.
    let ifcBytes = payload.compressed ? await extractIfcFromZip(bytes) : bytes;
    // The workers take the buffer via transfer; a view (byteOffset / shorter
    // length than its buffer) can't transfer cleanly, so normalise first. The
    // direct-.ifc path is already normalised (downloadObjectWithHash returns a
    // full-length buffer), so this only fires for fflate's decompressed ifcZIP
    // output, which can come back as a subarray view.
    if (ifcBytes.byteOffset !== 0 || ifcBytes.byteLength !== ifcBytes.buffer.byteLength) {
      ifcBytes = ifcBytes.slice();
    }

    logger.info({ size: ifcBytes.length, sha256: sha256.slice(0, 16) }, 'parsing IFC');

    const fragmentsKey = fragmentsKeyFor(payload.storage_key);
    const metadataKey = metadataKeyFor(payload.storage_key);
    const propertiesKey = propertiesKeyFor(payload.storage_key);

    // Uploads start the moment an artifact message arrives. The immediate
    // no-op catch keeps a pipelined upload failure from becoming an unhandled
    // rejection while the (possibly much later) Promise.all below hasn't
    // attached yet — the original promise still rejects there.
    const pendingUploads: Promise<void>[] = [];
    const startUpload = (key: string, body: Uint8Array | string, contentType: string): void => {
      const upload = uploadObject(key, body, contentType);
      upload.catch(() => undefined);
      pendingUploads.push(upload);
    };

    let outlineKey: string | null = null;
    let floorPlansKey: string | null = null;
    let projectGlobalId: string | null = null;
    let detectedKind: string | null = null;
    let storeys: StoreyInfo[] = [];

    logger.info('generating fragments + walking model');
    // One worker gets the IFC buffer via transfer, the other a copy (also
    // transferred) — main drops both references immediately, so the job never
    // holds three live copies of the IFC at once.
    const walkBytes = ifcBytes.slice();
    let fragWorker: ExtractionWorkerHandle | null = null;
    let walkWorker: ExtractionWorkerHandle | null = null;
    const threadsStart = performance.now();
    try {
      fragWorker = startExtractionWorker(
        { task: 'frag-outline', bytes: ifcBytes },
        [ifcBytes.buffer as ArrayBuffer],
        (msg) => {
          if (msg.type === 'fragments') {
            logStage('fragments', msg.ms);
            startUpload(fragmentsKey, msg.bytes, 'application/octet-stream');
          } else if (msg.type === 'outline') {
            if (msg.bytes === null) {
              // Graceful degradation: extraction still succeeds without the
              // artifact; the viewer computes outlines client-side instead.
              logger.warn(
                { error: msg.error, file_id: payload.file_id, job_id: job.job_id },
                'outline generation failed — viewer falls back to client-side compute',
              );
            } else {
              logStage('outline', msg.ms);
              outlineKey = outlineKeyFor(payload.storage_key);
              startUpload(outlineKey, msg.bytes, 'application/octet-stream');
            }
          }
        },
      );
      walkWorker = startExtractionWorker(
        { task: 'walk', bytes: walkBytes, discipline: payload.discipline },
        [walkBytes.buffer as ArrayBuffer],
        async (msg) => {
          if (msg.type === 'parsed') {
            logStage('parse', msg.ms);
            await reportProgress(40);
          } else if (msg.type === 'floorplans') {
            if (msg.bytes === null) {
              // No storeys, or generation failed — the job still succeeds and
              // the viewer simply hides the 2D floor-plan map.
              logger.warn(
                { error: msg.error, file_id: payload.file_id, job_id: job.job_id },
                'no floor-plan artifact — viewer hides the 2D map',
              );
            } else {
              logStage('floorplans', msg.ms);
              floorPlansKey = floorPlansKeyFor(payload.storage_key);
              startUpload(floorPlansKey, msg.bytes, 'application/octet-stream');
            }
          } else if (msg.type === 'walk') {
            logStage('walk', msg.timings.walk);
            projectGlobalId = msg.projectGlobalId;
            detectedKind = msg.detectedKind;
            storeys = msg.storeys;
            startUpload(metadataKey, msg.metadataJson, 'application/json');
            startUpload(propertiesKey, msg.propertiesJson, 'application/json');
          }
        },
      );
      // Time each thread independently so the logs show the real tail (frag +
      // outline vs. parse + walk + scan), making the per-job bottleneck visible.
      // Still fails fast: either rejection rejects the Promise.all exactly as
      // the plain `[fragWorker.done, walkWorker.done]` did.
      const fragDone = fragWorker.done.then(() => performance.now() - threadsStart);
      const walkDone = walkWorker.done.then(() => performance.now() - threadsStart);
      const [fragThreadMs, walkThreadMs] = await Promise.all([fragDone, walkDone]);
      logger.info(
        {
          file_id: payload.file_id,
          job_id: job.job_id,
          fragThreadMs: Math.round(fragThreadMs),
          walkThreadMs: Math.round(walkThreadMs),
          bottleneck: fragThreadMs >= walkThreadMs ? 'frag-outline' : 'walk',
        },
        'extraction thread balance',
      );
    } finally {
      // Any failure (either worker, schema gate, handler) must not leave the
      // sibling thread running; after natural completion this is a no-op.
      await Promise.allSettled([
        fragWorker?.terminate() ?? Promise.resolve(),
        walkWorker?.terminate() ?? Promise.resolve(),
      ]);
    }
    await reportProgress(80);

    logger.info(
      { fragmentsKey, metadataKey, propertiesKey, outlineKey, floorPlansKey },
      'uploading outputs',
    );
    const upload = await time(() => Promise.all(pendingUploads));
    logStage('upload', upload.ms);

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
      // Only when the artifact actually uploaded — a graceful outline failure
      // leaves the field off entirely.
      ...(outlineKey !== null ? { outline_key: outlineKey } : {}),
      ...(floorPlansKey !== null ? { floor_plans_key: floorPlansKey } : {}),
      ...(detectedKind !== null ? { detected_kind: detectedKind } : {}),
      ...(storeys.length > 0 ? { storeys } : {}),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      extractor_version: version,
      content_sha256: sha256,
      ifc_project_guid: projectGlobalId ?? undefined,
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
  }
}
