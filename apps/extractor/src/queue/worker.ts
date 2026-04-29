import { Worker } from 'bullmq';

import { getConfig, QUEUE_NAME } from '../config.js';
import { logger } from '../log.js';
import { runExtraction, type ExtractionJob } from '../pipeline/extract.js';
import { getRedis } from './queue.js';

export function startWorker(): Worker<ExtractionJob> {
  const cfg = getConfig();
  const worker = new Worker<ExtractionJob>(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, data: job.data }, 'job started');
      await runExtraction(job.data);
      logger.info({ jobId: job.id }, 'job finished');
    },
    {
      connection: getRedis(),
      concurrency: cfg.JOB_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job failed');
  });

  return worker;
}
