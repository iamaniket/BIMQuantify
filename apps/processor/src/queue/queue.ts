import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { getConfig, QUEUE_NAME } from '../config.js';

/**
 * Generic job envelope. Type-specific fields live inside `payload`. The
 * worker dispatches by `job_type`.
 */
export type WorkerJob = {
  job_id: string;
  job_type: 'ifc_extraction' | 'pdf_extraction' | 'compliance_report';
  // Routing key for the API's schema-per-tenant layout — echoed back in callbacks.
  organization_id: string;
  payload: Record<string, unknown>;
};

let cachedQueue: Queue<WorkerJob> | null = null;
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

export async function enqueueJob(job: WorkerJob): Promise<void> {
  // BullMQ refuses to add a job whose jobId matches an existing one. Using
  // `${job_id}-${epochMs}` keeps the job_id readable in logs while still
  // being unique per dispatch — the API's status machine already guards
  // against actual duplicate work.
  await getQueue().add(job.job_type, job, { jobId: `${job.job_id}-${Date.now()}` });
}

export async function closeQueue(): Promise<void> {
  if (cachedQueue !== null) {
    await cachedQueue.close();
    cachedQueue = null;
  }
  if (cachedConnection !== null) {
    cachedConnection.disconnect();
    cachedConnection = null;
  }
}
