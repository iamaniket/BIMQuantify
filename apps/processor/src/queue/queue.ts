import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { ACTION_QUEUE_NAME, getConfig, QUEUE_NAME } from '../config.js';

/**
 * Generic job envelope. Type-specific fields live inside `payload`. The
 * worker dispatches by `job_type`.
 */
export type WorkerJob = {
  job_id: string;
  job_type: 'ifc_extraction' | 'pdf_extraction' | 'pdf_pages_rasterization' | 'dxf_extraction' | 'image_metadata_extraction' | 'compliance_report' | 'assurance_plan_report' | 'completion_declaration_report' | 'dossier_report' | 'snag_list_report' | 'send_email';
  organization_id: string;
  payload: Record<string, unknown>;
  // Per-job callback base URL the API stamped on dispatch (L13). Absent on jobs
  // from a pre-fix API — the callback helpers then fall back to the baked
  // API_BASE_URL. See api/callbackContext.ts.
  callback_url?: string;
  // Single-queue BullMQ priority by user tier (free-wedge D5). Lower = higher
  // priority. Absent on jobs from a pre-priority API — enqueueJob defaults it
  // to the paying priority.
  priority?: number;
};

/**
 * Reports 0-100 pipeline progress. The worker wires this to BullMQ's
 * `job.updateProgress`; pipelines call it at stage boundaries. Optional in
 * pipeline signatures so unit tests can invoke a pipeline without a BullMQ job.
 */
export type ProgressReporter = (pct: number) => Promise<void> | void;

const ACTION_JOB_TYPES: ReadonlySet<string> = new Set(['send_email']);

let cachedQueue: Queue<WorkerJob> | null = null;
let cachedActionQueue: Queue<WorkerJob> | null = null;
let cachedConnection: Redis | null = null;

export function getRedis(): Redis {
  if (cachedConnection === null) {
    cachedConnection = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return cachedConnection;
}

export function getQueue(): Queue<WorkerJob> {
  if (cachedQueue === null) {
    cachedQueue = new Queue<WorkerJob>(QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return cachedQueue;
}

export function getActionQueue(): Queue<WorkerJob> {
  if (cachedActionQueue === null) {
    cachedActionQueue = new Queue<WorkerJob>(ACTION_QUEUE_NAME, {
      connection: getRedis(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
      },
    });
  }
  return cachedActionQueue;
}

/** BullMQ status → count map (active, waiting, completed, failed, delayed, …). */
export type QueueCounts = Record<string, number>;

/**
 * Live queue depth for the admin processor dashboard. `getJobCounts()` reads
 * Redis sorted-set cardinalities — cheap, no per-job hydration. `completed`
 * and `failed` are a recent window (bounded by `removeOnComplete`/`removeOnFail`
 * above), not lifetime totals.
 */
export async function getQueueStats(): Promise<{ jobs: QueueCounts; actions: QueueCounts }> {
  const [jobs, actions] = await Promise.all([
    getQueue().getJobCounts(),
    getActionQueue().getJobCounts(),
  ]);
  return { jobs, actions };
}

// Paying-tier BullMQ priority (mirrors the API's JOB_PRIORITY_PAYING default).
// A job arriving without an explicit priority (a pre-priority API) is treated as
// paying so it is never silently deprioritised. BullMQ: lower = higher.
const DEFAULT_PRIORITY = 10;

export async function enqueueJob(job: WorkerJob): Promise<void> {
  const isAction = ACTION_JOB_TYPES.has(job.job_type);
  const queue = isAction ? getActionQueue() : getQueue();
  // Use the API's job_id verbatim as the BullMQ job id so cancel can address
  // it. Safe because retry mints a fresh Job (new UUID) rather than re-adding
  // this id — BullMQ would otherwise dedupe a re-add against the same id.
  // Priority orders the single `jobs` queue by user tier (free-wedge D5); the
  // separate `actions` queue (send_email) stays FIFO.
  const opts = isAction
    ? { jobId: job.job_id }
    : { jobId: job.job_id, priority: job.priority ?? DEFAULT_PRIORITY };
  await queue.add(job.job_type, job, opts);
}

export type RemoveResult = 'removed' | 'active' | 'not_found';

/**
 * Best-effort cancel of a *queued* job by id. Returns:
 *   - `active`    — the worker already picked it up (BullMQ `isActive`); the
 *                   caller must let it run to completion (no mid-flight kill).
 *   - `removed`   — the queued job was dropped before it started.
 *   - `not_found` — no such job (already finished, evicted, or never existed).
 */
export async function removeQueuedJob(jobId: string): Promise<RemoveResult> {
  const job = await getQueue().getJob(jobId);
  if (job === undefined) return 'not_found';
  if (await job.isActive()) return 'active';
  await job.remove();
  return 'removed';
}

export async function closeQueue(): Promise<void> {
  if (cachedActionQueue !== null) {
    await cachedActionQueue.close();
    cachedActionQueue = null;
  }
  if (cachedQueue !== null) {
    await cachedQueue.close();
    cachedQueue = null;
  }
  if (cachedConnection !== null) {
    cachedConnection.disconnect();
    cachedConnection = null;
  }
}
