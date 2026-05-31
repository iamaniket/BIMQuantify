/**
 * Orchestrator for `assurance_plan_report` jobs (Borgingsplan PDF, #31).
 * A thin wrapper over the shared `runReportJob` with the borgingsplan payload
 * schema + template.
 */

import { z } from 'zod';

import type { ProgressReporter, WorkerJob } from '../../queue/queue.js';
import { runReportJob } from './index.js';
import { reportInstrumentSchema, reportProjectSchema } from './templates/_helpers.js';
import { renderHtml, type AssurancePlanData } from './templates/assurance-plan.js';

const PayloadSchema: z.ZodType<AssurancePlanData & { storage_key: string }> = z
  .object({
    report_id: z.string().uuid(),
    storage_key: z.string().min(1),
    generated_at: z.string().min(1),
    locale: z.string().min(1),
    project: reportProjectSchema,
    instrument: reportInstrumentSchema,
    assurance_plan: z.object({
      version_number: z.number(),
      status: z.string(),
      created_by: z.string().nullable().optional(),
      published_at: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      moments: z.array(
        z.object({
          phase: z.string(),
          name: z.string(),
          planned_date: z.string(),
          actual_date: z.string().nullable().optional(),
          responsible: z.string().nullable().optional(),
          status: z.string(),
          checklist_items: z.array(
            z.object({
              description: z.string(),
              evidence_type: z.string(),
              bbl_article_ref: z.string().nullable().optional(),
              pass_fail_criteria: z.string().nullable().optional(),
            }),
          ),
        }),
      ),
    }),
    risks: z.array(
      z.object({
        category: z.string(),
        level: z.string(),
        description: z.string(),
        mitigation: z.string(),
        responsible_party: z.string().nullable().optional(),
        bbl_article_ref: z.string().nullable().optional(),
      }),
    ),
  })
  .passthrough() as unknown as z.ZodType<AssurancePlanData & { storage_key: string }>;

export async function runAssurancePlanReport(
  job: WorkerJob,
  onProgress?: ProgressReporter,
): Promise<void> {
  return runReportJob(job, { payloadSchema: PayloadSchema, renderHtml }, onProgress);
}
