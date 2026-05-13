import { z } from 'zod';

export const ReportTypeSchema = z.enum(['compliance_report']);
export type ReportType = z.infer<typeof ReportTypeSchema>;

export const ReportStatusSchema = z.enum(['queued', 'running', 'ready', 'failed']);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

export const ReportSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  report_type: ReportTypeSchema,
  status: ReportStatusSchema,
  title: z.string(),
  locale: z.string(),
  job_id: z.string().uuid().nullable(),
  source_job_id: z.string().uuid().nullable(),
  storage_key: z.string().nullable(),
  byte_size: z.number().int().nullable(),
  sha256: z.string().nullable(),
  error: z.string().nullable(),
  download_url: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type Report = z.infer<typeof ReportSchema>;

export const ReportListSchema = z.object({
  items: z.array(ReportSchema),
  total: z.number().int(),
});
export type ReportList = z.infer<typeof ReportListSchema>;

export const CreateReportRequestSchema = z.object({
  report_type: ReportTypeSchema.default('compliance_report'),
  // BCP47 locale tag. Omit (or pass null) to let the server resolve from
  // the project's jurisdiction (NL → 'nl').
  locale: z.string().nullable().optional(),
  params: z.record(z.unknown()).default({}),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;
