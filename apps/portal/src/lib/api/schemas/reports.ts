import { z } from 'zod';

export const ReportTypeSchema = z.enum([
  'compliance_report',
  'assurance_plan', // NL: borgingsplan (#31)
  'completion_declaration', // NL: verklaring (#32)
  'dossier', // dossier bevoegd gezag (#33)
]);
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
  template_id: z.string().uuid().nullable().optional(),
  storage_key: z.string().nullable(),
  byte_size: z.number().int().nullable(),
  sha256: z.string().nullable(),
  error: z.string().nullable(),
  download_url: z.string().nullable(),
  // Inline-disposition presigned URL — renders the PDF in the preview dialog's
  // iframe (download_url forces a save). Populated alongside download_url.
  view_url: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
  // Verklaring sign-to-lock (#32). signed_at !== null ⇒ locked.
  signed_at: z.string().nullable(),
  signed_by_user_id: z.string().uuid().nullable(),
  signature_hash: z.string().nullable(),
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
  // Optional org report-template to render with (null = built-in / org default).
  template_id: z.string().uuid().nullable().optional(),
  params: z.record(z.unknown()).default({}),
});
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;
