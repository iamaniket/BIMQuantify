/**
 * BullMQ worker for the "actions" queue — lightweight tasks like email
 * delivery, external API calls, etc. Runs alongside the heavy-compute
 * "jobs" worker with higher concurrency and shorter lock duration.
 */

import { Worker } from 'bullmq';

import { ACTION_QUEUE_NAME, getConfig } from '../config.js';
import { runSendEmail } from '../email/send.js';
import { logger } from '../log.js';
import { getRedis, type WorkerJob } from './queue.js';

export function startActionWorker(): Worker<WorkerJob> {
  const cfg = getConfig();
  const worker = new Worker<WorkerJob>(
    ACTION_QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, jobType: job.data.job_type }, 'action started');
      switch (job.data.job_type) {
        case 'send_email':
          await runSendEmail(job.data);
          break;
        default:
          throw new Error(`unknown action job_type: ${String(job.data.job_type)}`);
      }
      logger.info({ jobId: job.id }, 'action finished');
    },
    {
      connection: getRedis(),
      concurrency: cfg.ACTION_CONCURRENCY,
      lockDuration: 30_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'action failed');
  });

  return worker;
}
