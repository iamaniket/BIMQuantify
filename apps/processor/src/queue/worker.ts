import { type Job, UnrecoverableError, Worker } from 'bullmq';

import { postAttachmentCallback } from '../api/attachmentCallback.js';
import { postCallback } from '../api/callback.js';
import { getConfig, QUEUE_NAME } from '../config.js';
import { logger } from '../log.js';
import { runExtraction } from '../pipeline/extract.js';
import { runImageMetadataExtraction } from '../pipeline/image.js';
import { runDxfExtraction } from '../pipeline/dxf.js';
import { runPdfExtraction } from '../pipeline/pdf.js';
import { postReportCallback } from '../pipeline/report/callback.js';
import { classifyError } from '../pipeline/errors.js';
import { runAssurancePlanReport } from '../pipeline/report/assurance-plan.js';
import { runDossierReport } from '../pipeline/report/dossier.js';
import { runComplianceReport } from '../pipeline/report/index.js';
import { runSnagListReport } from '../pipeline/report/snag-list.js';
import { runCompletionDeclarationReport } from '../pipeline/report/verklaring.js';
import { captureException } from '../sentry.js';
import { getRedis, type ProgressReporter, type WorkerJob } from './queue.js';

const pickStr = (payload: Record<string, unknown>, key: string): string => {
  const value = payload[key];
  if (typeof value === 'string') return value;
  // A missing routing id means the terminal-failure callback can't target the
  // real API row (it would POST an empty id), so the row stays non-terminal and
  // the UI spins. Log it so that exact failure mode is diagnosable rather than
  // silent. (The reconcile sweeper is the eventual backstop.)
  logger.error({ key, jobType: payload['job_type'] }, 'notifyTerminalFailure: payload is missing a string routing id');
  return '';
};

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
  const { retriable, error_kind } = classifyError(err);

  switch (data.job_type) {
    case 'ifc_extraction':
    case 'pdf_extraction':
    case 'dxf_extraction':
      await postCallback({
        file_id: pickStr(data.payload, 'file_id'),
        organization_id: data.organization_id,
        job_id: data.job_id,
        status: 'failed',
        error,
        finished_at,
        retriable,
        error_kind,
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
        retriable,
        error_kind,
      });
      break;
    case 'compliance_report':
    case 'assurance_plan_report':
    case 'completion_declaration_report':
    case 'dossier_report':
    case 'snag_list_report':
      await postReportCallback({
        report_id: pickStr(data.payload, 'report_id'),
        organization_id: data.organization_id,
        job_id: data.job_id,
        status: 'failed',
        error,
        finished_at,
        retriable,
        error_kind,
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

/**
 * Map a pipeline error onto the error we hand back to BullMQ.
 *
 * A permanently-bad input (corrupt/unsupported model, malformed payload, hash
 * mismatch) can never succeed on a retry, so re-running just burns the full
 * download + re-mesh + walk again — up to `attempts` times. Surface those as
 * BullMQ's `UnrecoverableError` so the job fails after a single attempt.
 * Retriable failures (network/S3/OOM/timeout, and the unknown default) pass
 * through unchanged so BullMQ still retries them. The original message is
 * preserved so the terminal backstop's `classifyError` keeps the right kind.
 */
export function toBullError(err: unknown): Error {
  if (classifyError(err).retriable) {
    return err instanceof Error ? err : new Error(String(err));
  }
  if (err instanceof UnrecoverableError) return err;
  return new UnrecoverableError(err instanceof Error ? err.message : String(err));
}

/**
 * Whether a failed job has reached a terminal state (BullMQ will not retry it):
 * either retries are exhausted, or it failed with an `UnrecoverableError`. The
 * latter check matters because an unrecoverable failure leaves `attemptsMade`
 * at 1 — the exhaustion test alone would skip the terminal backstop and strand
 * a throw-before-pipeline error (e.g. a malformed payload) in a non-terminal
 * API state.
 */
export function isTerminalFailure(
  attemptsMade: number,
  maxAttempts: number,
  err: Error,
): boolean {
  if (err instanceof UnrecoverableError || err.name === 'UnrecoverableError') return true;
  return attemptsMade >= maxAttempts;
}

export function startWorker(): Worker<WorkerJob> {
  const cfg = getConfig();
  const worker = new Worker<WorkerJob>(
    QUEUE_NAME,
    async (job) => {
      logger.info({ jobId: job.id, jobType: job.data.job_type }, 'job started');
      const onProgress: ProgressReporter = (pct) => job.updateProgress(pct);
      try {
        switch (job.data.job_type) {
          case 'ifc_extraction':
            await runExtraction(job.data, onProgress);
            break;
          case 'pdf_extraction':
            await runPdfExtraction(job.data, onProgress);
            break;
          case 'dxf_extraction':
            await runDxfExtraction(job.data, onProgress);
            break;
          case 'image_metadata_extraction':
            await runImageMetadataExtraction(job.data, onProgress);
            break;
          case 'compliance_report':
            await runComplianceReport(job.data, onProgress);
            break;
          case 'assurance_plan_report':
            await runAssurancePlanReport(job.data, onProgress);
            break;
          case 'completion_declaration_report':
            await runCompletionDeclarationReport(job.data, onProgress);
            break;
          case 'dossier_report':
            await runDossierReport(job.data, onProgress);
            break;
          case 'snag_list_report':
            await runSnagListReport(job.data, onProgress);
            break;
          case 'send_email':
            // Handled by the action worker on the "actions" queue.
            break;
          default: {
            const _exhaustive: never = job.data.job_type;
            throw new Error(`unknown job_type: ${String(_exhaustive)}`);
          }
        }
      } catch (err) {
        // Stop BullMQ retrying inputs that can never succeed (see toBullError).
        throw toBullError(err);
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
    // Only act once the job is terminal — retries exhausted, or an
    // UnrecoverableError BullMQ won't retry. Otherwise BullMQ will run it again.
    if (!isTerminalFailure(job.attemptsMade, job.opts.attempts ?? 1, err)) return;
    // Reached a terminal failure — report it, then make sure the API row also
    // lands in a terminal state.
    captureException(err, { jobId: job.id, jobType: job.data.job_type });
    void notifyTerminalFailure(job.data, err).catch((cbErr) => {
      logger.error({ jobId: job.id, err: cbErr }, 'terminal failure callback failed');
    });
  });

  return worker;
}
