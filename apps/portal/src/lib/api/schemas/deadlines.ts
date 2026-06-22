import { z } from 'zod';

// ---------------------------------------------------------------------------
// Deadline (project-level, read-only system-managed)
// ---------------------------------------------------------------------------

export const DeadlineStatusEnum = z.enum([
  'pending',
  'met',
  'not_applicable',
]);
export type DeadlineStatus = z.infer<typeof DeadlineStatusEnum>;

export const DeadlineSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  deadline_type: z.string(),
  due_date: z.string().nullable(),
  status: DeadlineStatusEnum,
  met_at: z.string().nullable(),
  met_by_user_id: z.string().uuid().nullable(),
  reference_number: z.string().nullable(),
  filing_notes: z.string().nullable(),
  filed_at: z.string().nullable(),
  is_overdue: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

export const DeadlineListSchema = z.array(DeadlineSchema);
export type DeadlineList = z.infer<typeof DeadlineListSchema>;

// ---------------------------------------------------------------------------
// Org-wide calendar (cross-project aggregation)
// ---------------------------------------------------------------------------

export const CalendarDeadlineSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  project_name: z.string(),
  country: z.string(),
  deadline_type: z.string(),
  label: z.string(),
  legal_reference: z.string().nullable(),
  due_date: z.string().nullable(),
  status: DeadlineStatusEnum,
  is_overdue: z.boolean(),
  days_until_due: z.number().int().nullable(),
});
export type CalendarDeadline = z.infer<typeof CalendarDeadlineSchema>;

export const CalendarDeadlineListSchema = z.array(CalendarDeadlineSchema);
export type CalendarDeadlineList = z.infer<typeof CalendarDeadlineListSchema>;

export const DeadlineWeekBucketSchema = z.object({
  days_from: z.number().int(),
  days_to: z.number().int(),
  count: z.number().int(),
});
export type DeadlineWeekBucket = z.infer<typeof DeadlineWeekBucketSchema>;

export const DeadlineSummarySchema = z.object({
  total: z.number().int(),
  pending: z.number().int(),
  met: z.number().int(),
  not_applicable: z.number().int(),
  overdue: z.number().int(),
  due_this_week: z.number().int(),
  upcoming_buckets: z.array(DeadlineWeekBucketSchema),
});
export type DeadlineSummary = z.infer<typeof DeadlineSummarySchema>;

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

export const FileDeadlineBodySchema = z.object({
  reference_number: z.string().optional(),
  filing_notes: z.string().optional(),
});
export type FileDeadlineBody = z.infer<typeof FileDeadlineBodySchema>;

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

export const ReadinessItemSchema = z.object({
  code: z.string(),
  label: z.string(),
  category: z.string(),
  required: z.boolean(),
  fulfilled: z.boolean(),
  count: z.number(),
});
export type ReadinessItem = z.infer<typeof ReadinessItemSchema>;

export const DeadlineReadinessSchema = z.object({
  deadline_id: z.string().uuid(),
  deadline_type: z.string(),
  items: z.array(ReadinessItemSchema),
  ready_count: z.number(),
  total_required: z.number(),
  is_ready: z.boolean(),
});
export type DeadlineReadiness = z.infer<typeof DeadlineReadinessSchema>;

// ---------------------------------------------------------------------------
// Deadline notification settings (effective = merged view)
// ---------------------------------------------------------------------------

export const EffectiveDeadlineNotificationSettingsSchema = z.object({
  deadline_type: z.string(),
  label: z.string(),
  reminder_days: z.array(z.number().int()),
  recipient_roles: z.array(z.string()),
  enabled: z.boolean(),
  source: z.string(), // "jurisdiction_default" | "org_default" | "project_override"
  legal_reference: z.string().nullable().optional(),
});
export type EffectiveDeadlineNotificationSettings = z.infer<
  typeof EffectiveDeadlineNotificationSettingsSchema
>;

export const EffectiveDeadlineNotificationSettingsListSchema = z.array(
  EffectiveDeadlineNotificationSettingsSchema,
);
export type EffectiveDeadlineNotificationSettingsList = z.infer<
  typeof EffectiveDeadlineNotificationSettingsListSchema
>;

// ---------------------------------------------------------------------------
// Update payload (for PATCH org-defaults / PUT project overrides)
// ---------------------------------------------------------------------------

export const DeadlineNotificationSettingsUpdateSchema = z.object({
  reminder_days: z.array(z.number().int()).optional(),
  recipient_roles: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
});
export type DeadlineNotificationSettingsUpdate = z.infer<
  typeof DeadlineNotificationSettingsUpdateSchema
>;
