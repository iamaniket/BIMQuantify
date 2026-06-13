/**
 * Spawn helper for the per-job extraction worker threads.
 *
 * One extraction job runs two `worker_threads` (entry: extraction-worker.ts):
 * 'frag-outline' (fragments + outline artifact) and 'walk' (parse + the
 * metadata/properties walk) — true multi-core parallelism instead of two CPU
 * pipelines time-slicing one event loop. This module owns the mechanics:
 *
 *   - entry resolution: under tsx/vitest this module's URL ends in `.ts`, so
 *     the worker boots via the plain-JS shim extraction-worker.boot.mjs (which
 *     registers tsx, then imports the .ts entry). `execArgv: ['--import',
 *     'tsx']` is silently ignored by Worker, and Node's native strip-types
 *     can't load this codebase. In the compiled dist the .js entry loads
 *     directly.
 *   - the message protocol types shared with extraction-worker.ts.
 *   - error re-hydration: structuredClone strips custom Error names and own
 *     props, so workers post a wire shape and the host rebuilds real
 *     UnsupportedSchemaError / PermanentError / RetriableError instances —
 *     instanceof checks in extract.ts and classifyError keep working.
 *   - a JOB_TIMEOUT_MS deadline: on expiry the worker is terminated and a
 *     retriable timeout error surfaces (classified exactly like the old
 *     in-process fragments timeout — `worker.terminate()` is the real
 *     cancellation now).
 */

import { Worker } from 'node:worker_threads';

import { getConfig } from '../config.js';
import type { DetectedKind } from './classify.js';
import { PermanentError, RetriableError } from './errors.js';
import { UnsupportedSchemaError } from './ifc.js';

/** workerData for extraction-worker.ts, discriminated on `task`. */
export type ExtractionTask =
  | { task: 'frag-outline'; bytes: Uint8Array }
  | { task: 'walk'; bytes: Uint8Array };

/** Flattened Error crossing the structuredClone boundary. `schema` carries
 * UnsupportedSchemaError's own prop; `kind` the Permanent/RetriableError
 * classification. */
export type WireError = {
  name: string;
  message: string;
  stack?: string;
  schema?: string;
  kind?: string;
};

export type ExtractionWorkerMessage =
  | { type: 'fragments'; bytes: Uint8Array; ms: number }
  // `bytes: null` = outline generation failed after fragments succeeded; the
  // job degrades gracefully (no artifact, viewer falls back to client compute).
  | { type: 'outline'; bytes: Uint8Array | null; ms: number; error?: string }
  // `bytes: null` = no floor-plan artifact (no storeys, or generation failed
  // after the walk succeeded); the job carries on and the viewer hides the 2D map.
  | { type: 'floorplans'; bytes: Uint8Array | null; ms: number; error?: string }
  | { type: 'parsed'; ms: number; schema: string }
  | {
      type: 'walk';
      metadataJson: Uint8Array;
      propertiesJson: Uint8Array;
      projectGlobalId: string | null;
      // Content-based discipline classification (from the element histogram).
      // Surfaced on the file as `detected_kind`; also gates the floor-plan cut.
      detectedKind: DetectedKind;
      timings: { metadata: number; properties: number; walk: number };
    }
  | { type: 'error'; error: WireError };

/** Everything the host's onMessage handler sees ('error' settles `done`). */
export type ExtractionWorkerEvent = Exclude<ExtractionWorkerMessage, { type: 'error' }>;

export type ExtractionWorkerHandle = {
  /** Settles once the task's terminal message has been handled (or it fails). */
  done: Promise<void>;
  /** Idempotent hard-stop; safe to call after natural completion. */
  terminate: () => Promise<void>;
};

export function toWireError(err: unknown): WireError {
  if (err instanceof Error) {
    const wire: WireError = { name: err.name, message: err.message };
    if (err.stack !== undefined) wire.stack = err.stack;
    const schema = (err as { schema?: unknown }).schema;
    if (typeof schema === 'string') wire.schema = schema;
    const kind = (err as { kind?: unknown }).kind;
    if (typeof kind === 'string') wire.kind = kind;
    return wire;
  }
  return { name: 'Error', message: String(err) };
}

export function rehydrateError(wire: WireError): Error {
  let err: Error;
  switch (wire.name) {
    case 'UnsupportedSchemaError':
      err = new UnsupportedSchemaError(
        wire.schema ?? wire.message.replace(/^UNSUPPORTED_SCHEMA:\s*/, ''),
      );
      break;
    case 'PermanentError':
      err = new PermanentError(wire.message, wire.kind);
      break;
    case 'RetriableError':
      err = new RetriableError(wire.message, wire.kind);
      break;
    default:
      err = new Error(wire.message);
      err.name = wire.name;
  }
  if (wire.stack !== undefined) err.stack = wire.stack;
  return err;
}

export function startExtractionWorker(
  data: ExtractionTask,
  transferList: readonly ArrayBuffer[],
  onMessage: (msg: ExtractionWorkerEvent) => void | Promise<void>,
): ExtractionWorkerHandle {
  const cfg = getConfig();
  // Boot shim (registers tsx) under tsx/vitest; compiled entry in dist. The
  // .boot.mjs sits in src/ only and is never compiled.
  const isTs = import.meta.url.endsWith('.ts');
  const entry = new URL(
    isTs ? './extraction-worker.boot.mjs' : './extraction-worker.js',
    import.meta.url,
  );
  const worker = new Worker(entry, {
    workerData: data,
    transferList: [...transferList],
  });
  const terminalType = data.task === 'walk' ? 'walk' : 'outline';

  const completion = new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    // Handlers run strictly in message order; a handler rejection fails the
    // task (the caller's finally then terminates the thread).
    let chain: Promise<void> = Promise.resolve();
    worker.on('message', (raw: ExtractionWorkerMessage) => {
      if (settled) return;
      if (raw.type === 'error') {
        settle(() => reject(rehydrateError(raw.error)));
        return;
      }
      chain = chain
        .then(async () => {
          if (settled) return;
          await onMessage(raw);
          if (raw.type === terminalType) settle(resolve);
        })
        .catch((err: unknown) => {
          settle(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
    });
    // Fallback rejection paths for failures that never reach the worker's own
    // catch (e.g. a crash while loading the entry module).
    worker.on('error', (err) => {
      settle(() => reject(rehydrateError(toWireError(err))));
    });
    worker.on('exit', (code) => {
      settle(() =>
        reject(new Error(`extraction worker (${data.task}) exited before completing (code ${code})`)),
      );
    });
  });

  let timer: NodeJS.Timeout | null = null;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Message + RetriableError kind both classify as a retriable timeout,
      // same as the old in-process fragments race (see errors.ts patterns).
      reject(
        new RetriableError(
          `extraction worker (${data.task}) timed out after ${cfg.JOB_TIMEOUT_MS}ms`,
          'timeout',
        ),
      );
    }, cfg.JOB_TIMEOUT_MS);
  });

  const done = (async (): Promise<void> => {
    try {
      await Promise.race([completion, deadline]);
    } catch (err) {
      // Hard-stop the thread before surfacing (deadline expiry included) —
      // terminate() is the only cancellation a worker has.
      await worker.terminate();
      throw err;
    } finally {
      if (timer !== null) clearTimeout(timer);
    }
  })();

  return {
    done,
    terminate: async (): Promise<void> => {
      await worker.terminate();
    },
  };
}
