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
  // Surfaced for the redesigned project cards / stat strip. All optional/nullable
  // so a missing field never blanks the list (the server already returns these on
  // ProjectRead). lifecycle_state drives the "N active · N archived" counts.
  thumbnail_url: z.union([z.string(), z.null()]).optional(),
  delivery_date: z.union([z.string(), z.null()]).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  lifecycle_state: z.string().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);
export type ProjectList = z.infer<typeof ProjectListSchema>;
