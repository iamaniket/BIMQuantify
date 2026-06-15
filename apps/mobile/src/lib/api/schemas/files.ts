import { z } from 'zod';

// Focused mobile copy of the portal ProjectFile — enough to pick the latest
// ready file for a model and label it. status is a plain string ('pending' |
// 'ready' | 'rejected'); we only branch on === 'ready'.
export const ProjectFileSchema = z.object({
  id: z.string(),
  model_id: z.string(),
  version_number: z.number().int(),
  original_filename: z.string(),
  file_type: z.string(),
  status: z.string(),
});

export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectFileListSchema = z.array(ProjectFileSchema);
export type ProjectFileList = z.infer<typeof ProjectFileListSchema>;
