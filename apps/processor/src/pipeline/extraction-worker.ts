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
import { detectContentKind, shouldGenerateFloorPlan } from './classify.js';
import { encodeFloorPlans, scanModelGeometry, sliceFloorPlans } from './floorplans.js';
import { generateFragments } from './fragments.js';
import { closeModel, getIfcApi, openModel } from './ifc.js';
import { buildMetadata, extractStoreys } from './metadata.js';
import {
  encodeOutline,
  extractLocalEdgePositions,
  mergeCollinearSegments,
  type OutlineInstance,
  type OutlineTemplate,
} from './outline.js';
import { buildProperties } from './properties.js';
import {
  type ExtractionTask,
  type ExtractionWorkerMessage,
  toWireError,
} from './worker-host.js';

// Mirrors the viewer's OutlineCache batch size — getItemsGeometry is
// synchronous here, batching just bounds per-call allocation.
const GEOMETRY_BATCH_SIZE = 1000;

// Column-major identity; only used if a mesh ever arrives without a transform
// (MeshData.transform is always populated in practice).
const IDENTITY_MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// FNV-1a over a mesh's local geometry bytes — the dedup fallback used only when
// a mesh carries no representationId, so identical shapes still collapse to one
// template. representationId is the fast path and wins whenever it is present.
function meshContentKey(mesh: {
  positions?: Float32Array | Float64Array | null;
  indices?: Uint8Array | Uint16Array | Uint32Array | null;
}): string {
  let h = 0x811c9dc5;
  const fold = (arr: ArrayBufferView | null | undefined): void => {
    if (!arr) return;
    const b = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < b.length; i += 1) {
      h ^= b[i]!;
      h = Math.imul(h, 0x01000193);
    }
  };
  fold(mesh.positions ?? null);
  fold(mesh.indices ?? null);
  return `h${(h >>> 0).toString(36)}`;
}

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

    // Dedup meshes into unique LOCAL-space edge templates keyed by the
    // fragments instancing key (representationId), then record one instance row
    // per element-mesh carrying its placement transform. Edges for a shared
    // shape are computed ONCE; the GPU re-places the template per instance.
    const templates: OutlineTemplate[] = [];
    const instances: OutlineInstance[] = [];
    const templateIndexByKey = new Map<string, number>(); // -1 ⇒ no hard edges
    let elementsWithEdges = 0;

    for (let i = 0; i < localIds.length; i += GEOMETRY_BATCH_SIZE) {
      const batch = localIds.slice(i, i + GEOMETRY_BATCH_SIZE);
      const meshArrays = model.getItemsGeometry(batch);
      for (let j = 0; j < meshArrays.length; j += 1) {
        const localId = batch[j];
        if (localId === undefined) continue;
        const meshes = meshArrays[j] ?? [];
        let hasEdges = false;
        for (const mesh of meshes) {
          const key =
            typeof mesh.representationId === 'number'
              ? `r${mesh.representationId}`
              : meshContentKey(mesh);
          let templateIndex = templateIndexByKey.get(key);
          if (templateIndex === undefined) {
            const local = extractLocalEdgePositions(mesh);
            if (local === null) {
              templateIndex = -1; // remember edge-less rep; never recompute
            } else {
              templateIndex = templates.length;
              templates.push(mergeCollinearSegments(local));
            }
            templateIndexByKey.set(key, templateIndex);
          }
          if (templateIndex < 0) continue;
          instances.push({
            localId,
            templateIndex,
            transform: mesh.transform ? mesh.transform.toArray() : IDENTITY_MATRIX,
          });
          hasEdges = true;
        }
        if (hasEdges) elementsWithEdges += 1;
      }
    }

    // Dedup ratio (instances ÷ templates) is the size win; logged so a model
    // whose representationId is missing (ratio ≈ 1) is visible in the logs.
    logger.info(
      {
        file_id: 'outline',
        localIds: localIds.length,
        elementsWithEdges,
        templates: templates.length,
        instances: instances.length,
      },
      'outline instancing summary',
    );

    const encoded = encodeOutline(templates, instances);
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
    // Skip the bbox in the metadata walk — the unified geometry sweep below
    // computes it in the same pass it uses for the floor-plan up-axis + cut
    // planes, so the model's geometry is streamed twice (scan + slice) instead
    // of four times (metadata bbox + floor-plan pass 1 + pass 2 + slice).
    const metadata = await buildMetadata(ifcApi, opened.modelID, opened.schema, logger, true);
    const metadataMs = Math.round(performance.now() - walkStart);
    const properties = await buildProperties(ifcApi, opened.modelID, metadata.elements, logger);
    const walkMs = Math.round(performance.now() - walkStart);

    // Classify the model from its element histogram. Drives the floor-plan gate
    // below and is surfaced on the file as `detected_kind`.
    const detectedKind = detectContentKind(metadata.elementCounts);

    // ONE geometry sweep for the bounding box AND the floor-plan up-axis + cut
    // planes. Runs unconditionally because the bbox is always needed; the slice
    // (pass 2) then runs only for plan-worthy content. The 1.2 m cut is an
    // architectural convention, so it is generated only for architectural/mixed
    // models — MEP/structural-only ones stay 3D-only (the cut would be noise).
    // Degrades gracefully: a failure, or a model with no storeys, posts
    // bytes:null and the viewer hides the 2D map.
    const fpStart = performance.now();
    const scan = scanModelGeometry(
      ifcApi,
      opened.modelID,
      metadata.project.lengthUnit,
      metadata.elements,
      logger,
    );
    metadata.bbox = scan.bbox;
    let floorPlansBytes: Uint8Array | null = null;
    if (shouldGenerateFloorPlan(detectedKind)) {
      try {
        const floorPlans = sliceFloorPlans(ifcApi, opened.modelID, scan, logger);
        if (floorPlans.levels.length > 0) floorPlansBytes = encodeFloorPlans(floorPlans);
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) },
          'floor-plan generation failed — viewer hides the 2D map',
        );
      }
    } else {
      logger.info(
        { detectedKind, file_id: 'walk' },
        'skipping floor-plan cut for non-architectural content — viewer stays 3D-only',
      );
    }
    const fpMs = Math.round(performance.now() - fpStart);
    if (floorPlansBytes !== null) {
      port.postMessage(
        { type: 'floorplans', bytes: floorPlansBytes, ms: fpMs } satisfies ExtractionWorkerMessage,
        [floorPlansBytes.buffer as ArrayBuffer],
      );
    } else {
      port.postMessage(
        { type: 'floorplans', bytes: null, ms: fpMs } satisfies ExtractionWorkerMessage,
      );
    }

    // Tiny (tens of rows) — carried inline on the message, not via an artifact.
    const storeys = extractStoreys(metadata.spatialTree);

    const encoder = new TextEncoder();
    const metadataJson = encoder.encode(JSON.stringify(metadata));
    const propertiesJson = encoder.encode(JSON.stringify(properties));
    port.postMessage(
      {
        type: 'walk',
        metadataJson,
        propertiesJson,
        projectGlobalId: metadata.project.globalId,
        detectedKind,
        storeys,
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
