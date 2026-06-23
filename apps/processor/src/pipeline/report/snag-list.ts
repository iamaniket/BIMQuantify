/**
 * Orchestrator for `snag_list_report` jobs (per-recipient bevindingen snag
 * list, #G2). A thin wrapper over the shared `runReportJob`:
 *   - prepare: download each finding photo from MinIO → embed as a base64 data
 *     URL so the HTML render can show it (mirrors the dossier).
 *   - postProcess: prepend the org template cover/letterhead, if any.
 * A missing/unreadable photo is logged and skipped rather than failing the job.
 */

import { z } from 'zod';

import { logger } from '../../log.js';
import type { ProgressReporter, WorkerJob } from '../../queue/queue.js';
import { downloadObject } from '../../storage/s3.js';
import { runReportJob } from './index.js';
import { reportProjectSchema, reportTemplateSchema } from './templates/_helpers.js';
import { renderHtml, type SnagListData } from './templates/snag-list.js';
import { embedTemplateLogo, mergeTemplateCover } from './templateAssets.js';

const PHOTO = z.object({
  storage_key: z.string(),
  content_type: z.string(),
  captured_at: z.string().nullable().optional(),
  data_url: z.string().optional(),
});

const PayloadSchema: z.ZodType<SnagListData & { storage_key: string }> = z
  .object({
    report_id: z.string().uuid(),
    storage_key: z.string().min(1),
    generated_at: z.string().min(1),
    locale: z.string().min(1),
    project: reportProjectSchema,
    findings: z.array(
      z.object({
        title: z.string(),
        description: z.string(),
        severity: z.string(),
        status: z.string(),
        assignee: z.string().nullable().optional(),
        deadline_date: z.string().nullable().optional(),
        bbl_article_ref: z.string().nullable().optional(),
        resolution_note: z.string().nullable().optional(),
        created_at: z.string().nullable().optional(),
        linked_element_global_id: z.string().nullable().optional(),
        linked_file_type: z.string().nullable().optional(),
        anchor_page: z.number().nullable().optional(),
        anchor_x: z.number().nullable().optional(),
        anchor_y: z.number().nullable().optional(),
        anchor_z: z.number().nullable().optional(),
        photos: z.array(PHOTO),
      }),
    ),
    recipient: z
      .object({
        name: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
      })
      .nullable(),
    filters: z.object({
      status: z.string().nullable().optional(),
      severity: z.string().nullable().optional(),
    }),
    template: reportTemplateSchema,
  })
  .passthrough() as unknown as z.ZodType<SnagListData & { storage_key: string }>;

type SnagListPayload = SnagListData & { storage_key: string };

/** Download each finding photo and embed it as a base64 data URL. */
async function prepare(payload: SnagListPayload): Promise<SnagListPayload> {
  for (const finding of payload.findings) {
    for (const photo of finding.photos) {
      try {
        const bytes = await downloadObject(photo.storage_key);
        photo.data_url = `data:${photo.content_type};base64,${Buffer.from(bytes).toString('base64')}`;
      } catch (err) {
        logger.warn({ err, key: photo.storage_key }, 'snag-list: photo download failed, skipping');
      }
    }
  }
  // Embed the template logo (if any) after the finding photos.
  await embedTemplateLogo(payload);
  return payload;
}

export async function runSnagListReport(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  return runReportJob(
    job,
    { payloadSchema: PayloadSchema, prepare, renderHtml, postProcess: mergeTemplateCover },
    onProgress,
  );
}
