import { z } from 'zod';

import { JobStatusSchema, JobTypeSchema } from './jobs';

/**
 * One non-terminal job in the super-admin processor feed — the tenant job
 * fields plus the cross-tenant context (owning org, freshness, stuck flag).
 * Mirrors `schemas/admin_jobs.py::AdminJobItem`.
 */
export const AdminJobItemSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  file_id: z.string().uuid().nullable(),
  job_type: JobTypeSchema,
  status: JobStatusSchema,
  error: z.string().nullable(),
  retriable: z.boolean(),
  error_kind: z.string().nullable(),
  progress: z.number().int(),
  retry_of: z.string().uuid().nullable(),
  attempt: z.number().int(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by_user_id: z.string().uuid().nullable(),
  // Cross-tenant annotations added by the admin endpoint.
  org_id: z.string().uuid(),
  org_name: z.string(),
  is_stuck: z.boolean(),
  age_seconds: z.number().int(),
});
export type AdminJobItem = z.infer<typeof AdminJobItemSchema>;

export const AdminActiveJobsSchema = z.object({
  summary: z.object({
    active: z.number().int(),
    stuck: z.number().int(),
  }),
  items: z.array(AdminJobItemSchema),
  truncated: z.boolean(),
  generated_at: z.string(),
});
export type AdminActiveJobs = z.infer<typeof AdminActiveJobsSchema>;

/**
 * Live BullMQ queue depth proxied from the processor. Each queue maps a
 * status name (waiting/active/completed/failed/delayed/…) to a count — kept
 * as an open record so new BullMQ statuses need no schema change.
 */
export const ProcessorQueueStatsSchema = z.object({
  jobs: z.record(z.number()),
  actions: z.record(z.number()),
});
export type ProcessorQueueStats = z.infer<typeof ProcessorQueueStatsSchema>;
