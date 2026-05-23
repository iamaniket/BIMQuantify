import { Worker } from 'bullmq';

import { getConfig, QUEUE_NAME } from '../config.js';
import { logger } from '../log.js';
import { runExtraction } from '../pipeline/extract.js';
import { runPdfExtraction } from '../pipeline/pdf.js';
import { runComplianceReport } from '../pipeline/report/index.js';
import { getRedis, type WorkerJob } from './queue.js';

export function startWorker(): Worker<WorkerJob> {
  const cfg = getConfig();
  const worker = new Worker<WorkerJob>(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, jobType: job.data.job_type }, 'job started');
      switch (job.data.job_type) {
        case 'ifc_extraction':
          await runExtraction(job.data);
          break;
        case 'pdf_extraction':
          await runPdfExtraction(job.data);
          break;
        case 'compliance_report':
          await runComplianceReport(job.data);
          break;
        case 'send_email':
          // Handled by the action worker on the "actions" queue.
          break;
        default: {
          const _exhaustive: never = job.data.job_type;
          throw new Error(`unknown job_type: ${String(_exhaustive)}`);
        }
      }
      logger.info({ jobId: job.id }, 'job finished');
    },
    {
      connection: getRedis(),
      concurrency: cfg.JOB_CONCURRENCY,
      lockDuration: cfg.JOB_TIMEOUT_MS + 30_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'job failed');
  });

  return worker;
}
