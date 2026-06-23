import { z } from 'zod';

export const ActivityCategorySchema = z.enum(['upload', 'scan', 'create', 'change', 'delete']);
export type ActivityCategory = z.infer<typeof ActivityCategorySchema>;

export const ProjectActivityEntrySchema = z.object({
  id: z.string().uuid(),
  action: z.string(),
  category: ActivityCategorySchema,
  actor_user_id: z.string().uuid().nullable(),
  actor_name: z.string().nullable(),
  resource_type: z.string(),
  resource_id: z.string().nullable(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  created_at: z.string(),
});
export type ProjectActivityEntry = z.infer<typeof ProjectActivityEntrySchema>;

export const ProjectActivityListSchema = z.array(ProjectActivityEntrySchema);
export type ProjectActivityList = z.infer<typeof ProjectActivityListSchema>;

/** One time bucket of the activity-over-time trend (only non-empty buckets are
 * returned; the client zero-fills its fixed time axis). `by_category` /
 * `by_resource` break `count` down for the hover tooltip; both carry only
 * non-zero entries and each sums to `count`. */
export const ActivityTimelineBucketSchema = z.object({
  bucket_start: z.string(),
  count: z.number(),
  by_category: z.record(z.number()),
  by_resource: z.record(z.number()),
});
export type ActivityTimelineBucket = z.infer<typeof ActivityTimelineBucketSchema>;

export const ActivityTimelineSchema = z.array(ActivityTimelineBucketSchema);
export type ActivityTimeline = z.infer<typeof ActivityTimelineSchema>;
