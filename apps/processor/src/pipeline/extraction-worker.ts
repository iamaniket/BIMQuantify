/**
 * Worker-thread entry for one extraction job (spawned and supervised by
 * worker-host.ts, which also defines the message protocol). Two tasks,
 * selected by `workerData.task`:
 *
 *   - 'frag-outline' — IFC → .frag bytes, posted immediately with a transfer
 *     list so the host starts the S3 upload while this thread keeps going:
 *     it then loads the fragments headless (SingleThreadedFragmentsModel) and
 *     computes the hard-edge outline artifact. An outline failure AFTER
 *     fragments succeeded posts `bytes: null` — the job carries on without
 *     the artifact and the viewer falls back to client-side edge compute.
 *   - 'walk' — own web-ifc instance (ifc.ts module state is per-thread), the
 *     schema gate, then buildMetadata + buildProperties. Results cross the
 *     thread boundary as transferred JSON bytes, never as structured-cloned
 *     object graphs (which would double peak memory on big models).
 *
 * Errors are flattened to a wire shape (structuredClone strips custom Error
 * names/own props) and re-hydrated by the host so instanceof checks hold.
 */

import { performance } from 'node:perf_hooks';
import { type MessagePort, parentPort, workerData } from 'node:worker_threads';

import { SingleThreadedFragmentsModel } from '@thatopen/fragments';

import { logger } from '../log.js';
import { generateFragments } from './fragments.js';
import { closeModel, getIfcApi, openModel } from './ifc.js';
import { buildMetadata } from './metadata.js';
import { elementEdgePositions, encodeOutline, type OutlineEntry } from './outline.js';
import { buildProperties } from './properties.js';
import {
  type ExtractionTask,
  type ExtractionWorkerMessage,
  toWireError,
} from './worker-host.js';

// Mirrors the viewer's OutlineCache batch size — getItemsGeometry is
// synchronous here, batching just bounds per-call allocation.
const GEOMETRY_BATCH_SIZE = 1000;

async function runFragOutline(port: MessagePort, bytes: Uint8Array): Promise<void> {
  const fragStart = performance.now();
  const fragBytes = await generateFragments(bytes);
  const fragMs = Math.round(performance.now() - fragStart);

  // The model gets its own copy so the original buffer can transfer to the
  // host immediately — the .frag upload starts while the outline computes.
  const modelBytes = fragBytes.slice();
  port.postMessage(
    { type: 'fragments', bytes: fragBytes, ms: fragMs } satisfies ExtractionWorkerMessage,
    [fragBytes.buffer as ArrayBuffer],
  );

  const outlineStart = performance.now();
  let model: SingleThreadedFragmentsModel | null = null;
  try {
    // Default raw=false pako-inflates exactly what IfcImporter.process()
    // produced (deflated by default).
    model = new SingleThreadedFragmentsModel('outline', modelBytes);
    // getLocalIds() — NOT getItemsWithGeometry(), which returns duplicates.
    const localIds = await model.getLocalIds();
    const entries: OutlineEntry[] = [];
    for (let i = 0; i < localIds.length; i += GEOMETRY_BATCH_SIZE) {
      const batch = localIds.slice(i, i + GEOMETRY_BATCH_SIZE);
      const meshArrays = model.getItemsGeometry(batch);
      for (let j = 0; j < meshArrays.length; j += 1) {
        const localId = batch[j];
        if (localId === undefined) continue;
        const positions = elementEdgePositions(meshArrays[j] ?? []);
        if (positions === null) continue; // zero-edge elements are omitted
        entries.push({ localId, positions });
      }
    }
    const encoded = encodeOutline(entries);
    port.postMessage(
      {
        type: 'outline',
        bytes: encoded,
        ms: Math.round(performance.now() - outlineStart),
      } satisfies ExtractionWorkerMessage,
      [encoded.buffer as ArrayBuffer],
    );
  } catch (err) {
    // Fragments already shipped — never fail the task here. The job succeeds
    // without the artifact and the viewer falls back to client-side compute.
    port.postMessage({
      type: 'outline',
      bytes: null,
      ms: Math.round(performance.now() - outlineStart),
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    } satisfies ExtractionWorkerMessage);
  } finally {
    // Mandatory — the model's MeshConnection starts a setInterval that would
    // otherwise keep this thread alive forever.
    model?.dispose();
  }
}

async function runWalk(port: MessagePort, bytes: Uint8Array): Promise<void> {
  const parseStart = performance.now();
  // Schema gate inside openModel; UnsupportedSchemaError propagates to the
  // wire-error catch in main() and is re-hydrated host-side.
  const opened = await openModel(bytes);
  port.postMessage({
    type: 'parsed',
    ms: Math.round(performance.now() - parseStart),
    schema: opened.schema,
  } satisfies ExtractionWorkerMessage);

  try {
    const ifcApi = await getIfcApi();
    const walkStart = performance.now();
    const metadata = await buildMetadata(ifcApi, opened.modelID, opened.schema, logger);
    const metadataMs = Math.round(performance.now() - walkStart);
    const properties = await buildProperties(ifcApi, opened.modelID, metadata.elements, logger);
    const walkMs = Math.round(performance.now() - walkStart);

    const encoder = new TextEncoder();
    const metadataJson = encoder.encode(JSON.stringify(metadata));
    const propertiesJson = encoder.encode(JSON.stringify(properties));
    port.postMessage(
      {
        type: 'walk',
        metadataJson,
        propertiesJson,
        projectGlobalId: metadata.project.globalId,
        timings: { metadata: metadataMs, properties: walkMs - metadataMs, walk: walkMs },
      } satisfies ExtractionWorkerMessage,
      [metadataJson.buffer as ArrayBuffer, propertiesJson.buffer as ArrayBuffer],
    );
  } finally {
    // The model dies with this thread anyway; explicit close for hygiene.
    await closeModel(opened.modelID);
  }
}

async function main(): Promise<void> {
  const port = parentPort;
  if (port === null) {
    throw new Error('extraction-worker must be started as a worker thread');
  }
  const data = workerData as ExtractionTask;
  switch (data.task) {
    case 'frag-outline':
      await runFragOutline(port, data.bytes);
      break;
    case 'walk':
      await runWalk(port, data.bytes);
      break;
    default: {
      const _exhaustive: never = data;
      throw new Error(`unknown extraction worker task: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

void main().catch((err: unknown) => {
  parentPort?.postMessage({
    type: 'error',
    error: toWireError(err),
  } satisfies ExtractionWorkerMessage);
});
