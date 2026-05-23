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
  is_overdue: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Deadline = z.infer<typeof DeadlineSchema>;

export const DeadlineListSchema = z.array(DeadlineSchema);
export type DeadlineList = z.infer<typeof DeadlineListSchema>;

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
