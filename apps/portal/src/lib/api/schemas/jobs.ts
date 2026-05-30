import { z } from 'zod';

export const JobTypeSchema = z.enum([
  'ifc_extraction',
  'pdf_extraction',
  'verification',
  'batch_update',
  'image_metadata_extraction',
  'compliance_check',
  'compliance_report',
]);
export type JobType = z.infer<typeof JobTypeSchema>;

export const JobStatusSchema = z.enum([
  'pending',
  'started',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  file_id: z.string().uuid().nullable(),
  job_type: JobTypeSchema,
  status: JobStatusSchema,
  error: z.string().nullable(),
  // Failure classification — drives the Retry affordance.
  retriable: z.boolean(),
  error_kind: z.string().nullable(),
  // 0-100 progress reported by the worker.
  progress: z.number().int(),
  retry_of: z.string().uuid().nullable(),
  attempt: z.number().int(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by_user_id: z.string().uuid().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const JobListResponseSchema = z.object({
  items: z.array(JobSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type JobListResponse = z.infer<typeof JobListResponseSchema>;

/** A job is in-flight (worth polling) while it has not reached a terminal state. */
export const JOB_ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  'pending',
  'started',
  'running',
]);

export function isJobActive(status: JobStatus): boolean {
  return JOB_ACTIVE_STATUSES.has(status);
}
