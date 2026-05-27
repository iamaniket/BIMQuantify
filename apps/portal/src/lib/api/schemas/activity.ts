import { z } from 'zod';

export const ActivityCategorySchema = z.enum(['upload', 'scan', 'change']);
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
