import { z } from 'zod';

import { ActivityTimelineBucketSchema } from './activity';
import { AttachmentSchema } from './attachments';
import { CertificateSchema } from './certificates';
import { DeadlineSchema, ReadinessItemSchema } from './deadlines';
import { FindingSchema } from './findings';
import { ProjectMemberSchema, ProjectSchema } from './projects';
import { ReportSchema } from './reports';

// ---------------------------------------------------------------------------
// Project overview — the BFF aggregate behind GET /projects/{id}/overview.
//
// One call assembles the whole project-detail dashboard (header KPIs, the
// completeness donut, capped previews + exact counts per resource, members and
// the activity trend), replacing ~10 separate cold-load requests. Every block
// reuses the existing per-resource Read schemas so the portal shares its types.
// Mirrors apps/api/.../schemas/project_overview.py + deadlines/completeness.py.
// ---------------------------------------------------------------------------

// --- Completeness donut (mirror of deadlines/completeness.py) --------------

export const CompletenessSegmentSchema = z.object({
  category: z.string(),
  filled: z.number(),
  total: z.number(),
});
export type CompletenessSegment = z.infer<typeof CompletenessSegmentSchema>;

export const DossierBlockSchema = z.object({
  filled: z.number(),
  total: z.number(),
  pct: z.number(),
  optional_filled: z.number(),
  optional_total: z.number(),
  segments: z.array(CompletenessSegmentSchema),
  items: z.array(ReadinessItemSchema),
});
export type DossierBlock = z.infer<typeof DossierBlockSchema>;

export const FindingsRingBlockSchema = z.object({
  total: z.number(),
  complete: z.number(),
  by_status: z.record(z.number()),
});
export type FindingsRingBlock = z.infer<typeof FindingsRingBlockSchema>;

export const DeadlinesRingBlockSchema = z.object({
  total: z.number(),
  met: z.number(),
  pending: z.number(),
  overdue: z.number(),
});
export type DeadlinesRingBlock = z.infer<typeof DeadlinesRingBlockSchema>;

export const CompletenessBlockSchema = z.object({
  overall_filled: z.number(),
  overall_total: z.number(),
  overall_pct: z.number(),
  dossier: DossierBlockSchema,
  findings: FindingsRingBlockSchema,
  deadlines: DeadlinesRingBlockSchema,
});
export type CompletenessBlock = z.infer<typeof CompletenessBlockSchema>;

// --- Per-resource preview blocks (count + capped preview) ------------------

export const OverviewFindingsBlockSchema = z.object({
  count: z.number(),
  // open + in_progress (the "still needs work" count).
  open: z.number(),
  preview: z.array(FindingSchema),
});
export type OverviewFindingsBlock = z.infer<typeof OverviewFindingsBlockSchema>;

export const OverviewCertificatesBlockSchema = z.object({
  count: z.number(),
  expired: z.number(),
  expiring_soon: z.number(),
  preview: z.array(CertificateSchema),
});
export type OverviewCertificatesBlock = z.infer<typeof OverviewCertificatesBlockSchema>;

export const OverviewAttachmentsBlockSchema = z.object({
  count: z.number(),
  preview: z.array(AttachmentSchema),
});
export type OverviewAttachmentsBlock = z.infer<typeof OverviewAttachmentsBlockSchema>;

export const OverviewReportsBlockSchema = z.object({
  count: z.number(),
  preview: z.array(ReportSchema),
});
export type OverviewReportsBlock = z.infer<typeof OverviewReportsBlockSchema>;

// `preview` is the full (small) deadline list — seeds the deadlines tab.
export const OverviewDeadlinesBlockSchema = z.object({
  total: z.number(),
  met: z.number(),
  overdue: z.number(),
  preview: z.array(DeadlineSchema),
});
export type OverviewDeadlinesBlock = z.infer<typeof OverviewDeadlinesBlockSchema>;

export const OverviewStatsSchema = z.object({
  deadlines_met: z.number(),
  deadlines_total: z.number(),
  attachments_count: z.number(),
  // Dossier-only required percentage (the header's HOLDBACK chip).
  holdback_pct: z.number(),
  delivery_days_remaining: z.union([z.number(), z.null()]),
});
export type OverviewStats = z.infer<typeof OverviewStatsSchema>;

export const ProjectOverviewSchema = z.object({
  project: ProjectSchema,
  completeness: CompletenessBlockSchema,
  stats: OverviewStatsSchema,
  findings: OverviewFindingsBlockSchema,
  certificates: OverviewCertificatesBlockSchema,
  attachments: OverviewAttachmentsBlockSchema,
  reports: OverviewReportsBlockSchema,
  deadlines: OverviewDeadlinesBlockSchema,
  members: z.array(ProjectMemberSchema),
  activity_timeline: z.array(ActivityTimelineBucketSchema),
});
export type ProjectOverview = z.infer<typeof ProjectOverviewSchema>;
