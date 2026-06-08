/**
 * Shared orchestrator for report-rendering jobs (compliance_report and, as they
 * land, assurance_plan / completion_declaration / dossier — backlog #31/#32/#33).
 *
 * Stateless worker: everything the renderer needs is in `job.payload`. We never
 * call back to the API for input data — only for status updates. Binary blobs
 * (dossier photos, certificate PDFs) are fetched from MinIO by the renderer /
 * postProcess via storage keys carried in the payload, never round-tripped
 * through the API.
 *
 * Flow (identical for every report type):
 *   1. validate payload (zod)
 *   2. POST callback: status=running
 *   3. renderHtml(payload) → htmlToPdf(html) → [postProcess] → upload to S3
 *   4. POST callback: status=ready (with storage_key, byte_size, sha256)
 *   5. on any error: POST callback status=failed
 */

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { logger } from '../../log.js';
import type { ProgressReporter, WorkerJob } from '../../queue/queue.js';
import { uploadObject } from '../../storage/s3.js';
import { classifyError } from '../errors.js';
import { postReportCallback } from './callback.js';
import { htmlToPdf } from './pdf.js';
import { renderHtml, type ComplianceReportData } from './templates/compliance-report.js';

/** The fields every report payload carries — the orchestrator reads these. */
export type BaseReportPayload = {
  report_id: string;
  storage_key: string;
  generated_at: string;
};

export type ReportRenderer<T extends BaseReportPayload> = {
  /** Runtime validation of the job payload. */
  payloadSchema: z.ZodType<T>;
  /**
   * Optional async pre-render step — e.g. the dossier downloads finding photos
   * from MinIO and embeds them as base64 data URLs. Returns the (possibly
   * augmented) payload that `renderHtml` + `postProcess` then receive.
   */
  prepare?: (payload: T) => Promise<T> | T;
  /** Payload → full HTML document. */
  renderHtml: (payload: T) => string;
  /**
   * Optional post-render step on the raw PDF bytes — e.g. the dossier merges
   * downloaded certificate PDFs via pdf-lib. Receives and returns PDF bytes.
   */
  postProcess?: (pdfBytes: Uint8Array, payload: T) => Promise<Uint8Array> | Uint8Array;
};

/**
 * Run one report job end-to-end. Generic over the payload shape so each report
 * type supplies its own schema + template (+ optional post-process) while the
 * running/ready/failed callbacks, hashing, and S3 upload stay in one place.
 */
export async function runReportJob<T extends BaseReportPayload>(
  job: WorkerJob,
  renderer: ReportRenderer<T>,
  onProgress?: ProgressReporter,
): Promise<void> {
  const parsed = renderer.payloadSchema.safeParse(job.payload);
  if (!parsed.success) {
    const msg = `INVALID_REPORT_PAYLOAD: ${parsed.error.message.slice(0, 200)}`;
    logger.error({ jobId: job.job_id, issues: parsed.error.issues }, 'invalid report payload');
    await postReportCallback({
      report_id: typeof job.payload['report_id'] === 'string' ? job.payload['report_id'] : '',
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'failed',
      error: msg,
      finished_at: new Date().toISOString(),
    }).catch(() => undefined);
    throw new Error(msg);
  }

  const payload = parsed.data;
  const startedAt = new Date().toISOString();

  // The "running" callback is a progress indicator, not a gate. It may 404
  // when the API transaction that created the report row has not committed yet
  // (the dispatch happens inside the tenant transaction). Non-fatal: log and
  // continue — the terminal ready/failed callback will succeed once the row is
  // visible.
  await postReportCallback({
    report_id: payload.report_id,
    organization_id: job.organization_id,
    job_id: job.job_id,
    status: 'running',
    started_at: startedAt,
  }).catch((err) => {
    logger.warn(
      { reportId: payload.report_id, err: (err as Error).message },
      'running callback failed (non-fatal, likely transaction race)',
    );
  });

  try {
    const prepared = renderer.prepare ? await renderer.prepare(payload) : payload;
    await onProgress?.(15);

    logger.info({ reportId: payload.report_id }, 'rendering report HTML');
    const html = renderer.renderHtml(prepared);
    await onProgress?.(30);

    logger.info({ reportId: payload.report_id }, 'driving Puppeteer to PDF');
    let pdfBytes = await htmlToPdf(html, { generatedAt: payload.generated_at });
    await onProgress?.(80);

    if (renderer.postProcess) {
      pdfBytes = await renderer.postProcess(pdfBytes, prepared);
      await onProgress?.(90);
    }

    const sha256 = createHash('sha256').update(pdfBytes).digest('hex');

    logger.info(
      { reportId: payload.report_id, storageKey: payload.storage_key, bytes: pdfBytes.length },
      'uploading PDF to S3',
    );
    await uploadObject(payload.storage_key, Buffer.from(pdfBytes), 'application/pdf');

    await postReportCallback({
      report_id: payload.report_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'ready',
      storage_key: payload.storage_key,
      byte_size: pdfBytes.length,
      sha256,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : 'UNKNOWN_ERROR';
    logger.error({ err, reportId: payload.report_id }, 'report generation failed');
    const { retriable, error_kind } = classifyError(err);
    await postReportCallback({
      report_id: payload.report_id,
      organization_id: job.organization_id,
      job_id: job.job_id,
      status: 'failed',
      error: message.slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      retriable,
      error_kind,
    }).catch(() => undefined);
    throw err;
  }
}

// Mirror of ComplianceReportData but enforced at runtime.
const CompliancePayloadSchema: z.ZodType<ComplianceReportData & { storage_key: string }> = z
  .object({
    report_id: z.string().uuid(),
    storage_key: z.string().min(1),
    generated_at: z.string().min(1),
    locale: z.string().min(1),
    project: z.object({
      id: z.string(),
      name: z.string(),
      reference_code: z.string().nullable().optional(),
      status: z.string().nullable().optional(),
      phase: z.string().nullable().optional(),
      address: z
        .object({
          street: z.string().nullable().optional(),
          house_number: z.string().nullable().optional(),
          postal_code: z.string().nullable().optional(),
          city: z.string().nullable().optional(),
          municipality: z.string().nullable().optional(),
          bag_id: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      permit_number: z.string().nullable().optional(),
      delivery_date: z.string().nullable().optional(),
      contractor: z
        .object({
          name: z.string().nullable().optional(),
          kvk_number: z.string().nullable().optional(),
          contact_email: z.string().nullable().optional(),
          contact_phone: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
    compliance: z.record(z.unknown()),
  })
  .passthrough() as unknown as z.ZodType<ComplianceReportData & { storage_key: string }>;

/**
 * Orchestrator for `compliance_report` jobs — a thin wrapper over the shared
 * `runReportJob` with the compliance payload schema + template.
 */
export async function runComplianceReport(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  return runReportJob(job, { payloadSchema: CompliancePayloadSchema, renderHtml }, onProgress);
}
