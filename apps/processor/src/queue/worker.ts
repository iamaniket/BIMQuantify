import { type Job, Worker } from 'bullmq';

import { postAttachmentCallback } from '../api/attachmentCallback.js';
import { postCallback } from '../api/callback.js';
import { getConfig, QUEUE_NAME } from '../config.js';
import { logger } from '../log.js';
import { runExtraction } from '../pipeline/extract.js';
import { runImageMetadataExtraction } from '../pipeline/image.js';
import { runPdfExtraction } from '../pipeline/pdf.js';
import { postReportCallback } from '../pipeline/report/callback.js';
import { runComplianceReport } from '../pipeline/report/index.js';
import { getRedis, type WorkerJob } from './queue.js';

const pickStr = (payload: Record<string, unknown>, key: string): string =>
  typeof payload[key] === 'string' ? (payload[key] as string) : '';

/**
 * Last-resort failed callback once BullMQ has exhausted all retries.
 *
 * The pipelines post their own `failed` callback from their catch blocks,
 * but that misses two cases: a throw *before* the try (e.g. malformed
 * payload in `parseIfcPayload`, which never posts anything) and the
 * pipeline's own callback POST failing while the API is briefly down. In
 * either case the API row is left in `running`/`queued` forever. This
 * routes a terminal `failed` to the right endpoint by job_type so the row
 * always reaches a terminal state. Terminal callbacks are idempotent on the
 * API, so the occasional duplicate (pipeline + this) is harmless.
 */
async function notifyTerminalFailure(data: WorkerJob, err: Error): Promise<void> {
  const error = `${err.name}: ${err.message}`.slice(0, 500);
  const finished_at = new Date().toISOString();

  switch (data.job_type) {
    case 'ifc_extraction':
    case 'pdf_extraction':
      await postCallback({
        file_id: pickStr(data.payload, 'file_id'),
        organization_id: data.organization_id,
        job_id: data.job_id,
        status: 'failed',
        error,
        finished_at,
      });
      break;
    case 'image_metadata_extraction':
      await postAttachmentCallback({
        attachment_id: pickStr(data.payload, 'attachment_id'),
        organization_id: data.organization_id,
        job_id: data.job_id,
        status: 'failed',
        error,
        finished_at,
      });
      break;
    case 'compliance_report':
      await postReportCallback({
        report_id: pickStr(data.payload, 'report_id'),
        organization_id: data.organization_id,
        job_id: data.job_id,
        status: 'failed',
        error,
        finished_at,
      });
      break;
    case 'send_email':
      // Lives on the actions queue — never processed by this worker.
      break;
    default: {
      const _exhaustive: never = data.job_type;
      void _exhaustive;
    }
  }
}

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
        case 'image_metadata_extraction':
          await runImageMetadataExtraction(job.data);
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

  worker.on('failed', (job: Job<WorkerJob> | undefined, err: Error) => {
    logger.error({ jobId: job?.id, attemptsMade: job?.attemptsMade, err }, 'job failed');
    if (!job) return;
    // Only act once retries are exhausted — otherwise BullMQ will run it again.
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;
    void notifyTerminalFailure(job.data, err).catch((cbErr) => {
      logger.error({ jobId: job.id, err: cbErr }, 'terminal failure callback failed');
    });
  });

  return worker;
}
