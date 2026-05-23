import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { ACTION_QUEUE_NAME, getConfig, QUEUE_NAME } from '../config.js';

/**
 * Generic job envelope. Type-specific fields live inside `payload`. The
 * worker dispatches by `job_type`.
 */
export type WorkerJob = {
  job_id: string;
  job_type: 'ifc_extraction' | 'pdf_extraction' | 'compliance_report' | 'send_email';
  organization_id: string;
  payload: Record<string, unknown>;
};

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

export async function enqueueJob(job: WorkerJob): Promise<void> {
  const queue = ACTION_JOB_TYPES.has(job.job_type) ? getActionQueue() : getQueue();
  await queue.add(job.job_type, job, { jobId: `${job.job_id}-${Date.now()}` });
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
