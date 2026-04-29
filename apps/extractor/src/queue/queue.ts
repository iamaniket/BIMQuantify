import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { getConfig, QUEUE_NAME } from '../config.js';
import type { ExtractionJob } from '../pipeline/extract.js';

let cachedQueue: Queue<ExtractionJob> | null = null;
let cachedConnection: Redis | null = null;

export function getRedis(): Redis {
  if (cachedConnection === null) {
    cachedConnection = new Redis(getConfig().REDIS_URL, {
      maxRetriesPerRequest: null,
    });
  }
  return cachedConnection;
}

export function getQueue(): Queue<ExtractionJob> {
  if (cachedQueue === null) {
    cachedQueue = new Queue<ExtractionJob>(QUEUE_NAME, {
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

export async function enqueueExtraction(job: ExtractionJob): Promise<void> {
  // BullMQ refuses to add a job whose jobId matches an existing one. Using
  // `${file_id}-${epochMs}` keeps the file_id readable in logs while still
  // being unique per dispatch — the API's status machine already guards
  // against actual duplicate work.
  await getQueue().add('extract', job, { jobId: `${job.file_id}-${Date.now()}` });
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
