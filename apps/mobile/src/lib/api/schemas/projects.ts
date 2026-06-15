import { z } from 'zod';

// Focused mobile copy of the portal Project — only the fields the list renders.
// Zod strips unknown keys, so the server's full payload still parses. Display
// enums (status/phase) are kept as plain strings so a new server value can't
// blank the list; labels are mapped with a fallback in the UI.
export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.union([z.string(), z.null()]).optional(),
  reference_code: z.union([z.string(), z.null()]).optional(),
  status: z.string(),
  phase: z.string().optional(),
  city: z.union([z.string(), z.null()]).optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);
export type ProjectList = z.infer<typeof ProjectListSchema>;
