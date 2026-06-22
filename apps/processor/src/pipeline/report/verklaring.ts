/**
 * Orchestrator for `completion_declaration_report` jobs (Verklaring PDF, #32).
 * Thin wrapper over the shared `runReportJob` with the verklaring payload
 * schema + template.
 */

import { z } from 'zod';

import type { ProgressReporter, WorkerJob } from '../../queue/queue.js';
import { runReportJob } from './index.js';
import { reportProjectSchema, reportTemplateSchema } from './templates/_helpers.js';
import { renderHtml, type VerklaringData } from './templates/verklaring.js';
import { embedTemplateLogo, mergeTemplateCover } from './templateAssets.js';

const PayloadSchema: z.ZodType<VerklaringData & { storage_key: string }> = z
  .object({
    report_id: z.string().uuid(),
    storage_key: z.string().min(1),
    generated_at: z.string().min(1),
    locale: z.string().min(1),
    project: reportProjectSchema,
    declaration: z.object({
      kwaliteitsborger: z.string().nullable().optional(),
      kwaliteitsborger_email: z.string().nullable().optional(),
      signed: z.boolean(),
      signed_at: z.string().nullable().optional(),
      signature_hash: z.string().nullable().optional(),
    }),
    template: reportTemplateSchema,
  })
  .passthrough() as unknown as z.ZodType<VerklaringData & { storage_key: string }>;

export async function runCompletionDeclarationReport(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  return runReportJob(
    job,
    {
      payloadSchema: PayloadSchema,
      prepare: embedTemplateLogo,
      renderHtml,
      postProcess: mergeTemplateCover,
    },
    onProgress,
  );
}
