import { z } from 'zod';

// Public, unauthenticated login-screen data. Mirrors the portal's
// useProjectsMap / useSystemStatus response schemas
// (apps/portal/src/features/auth/), so the mobile login renders the same live
// project map + KPI/status the web does.

export const ProjectsMapPointSchema = z.object({
  city: z.string(),
  lat: z.number(),
  lng: z.number(),
  count: z.number().int().min(1),
});

export const ProjectsMapResponseSchema = z.array(ProjectsMapPointSchema);

export type ProjectsMapPoint = z.infer<typeof ProjectsMapPointSchema>;

export const SystemStatusSchema = z.object({
  status: z.enum(['normal', 'degraded', 'down']),
  region: z.string(),
  node: z.string(),
  wkb_version: z.string(),
  bbl_version: z.string(),
  ifc_version: z.string(),
  checks: z.record(z.string(), z.boolean()),
});

export type SystemStatus = z.infer<typeof SystemStatusSchema>;
