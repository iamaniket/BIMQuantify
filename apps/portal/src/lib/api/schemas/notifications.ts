import { z } from 'zod';

export const NotificationEventTypeEnum = z.enum([
  'job_started',
  'job_succeeded',
  'job_failed',
  'job_progress',
  'deadline_upcoming',
  'deadline_missed',
  'finding_created',
  'finding_resolved',
  'finding_mentioned',
  'invitation_sent',
  'invitation_accepted',
]);

export type NotificationEventTypeValue = z.infer<typeof NotificationEventTypeEnum>;

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.union([z.string().uuid(), z.null()]),
  file_id: z.union([z.string().uuid(), z.null()]),
  job_id: z.union([z.string().uuid(), z.null()]),
  event_type: NotificationEventTypeEnum,
  title: z.string(),
  body: z.string(),
  is_read: z.boolean(),
  created_at: z.string(),
});

export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationSchema),
  total: z.number(),
  unread_count: z.number(),
  limit: z.number(),
  offset: z.number(),
  // Opaque keyset cursor for "load more" (pass back as ?cursor=). Null/absent
  // when there are no more rows. Optional so existing offset callers are unaffected.
  next_cursor: z.union([z.string(), z.null()]).optional(),
});

export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const UnreadCountResponseSchema = z.object({
  count: z.number(),
});

export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;
