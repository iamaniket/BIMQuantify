import { z } from 'zod';

export const ProjectLifecycleStateEnum = z.enum(['active', 'archived', 'removed']);

export type ProjectLifecycleStateValue = z.infer<typeof ProjectLifecycleStateEnum>;

export const ProjectPhaseEnum = z.enum([
  'design',
  'tender',
  'work_prep',
  'shell',
  'finishing',
  'handover',
]);

export type ProjectPhaseValue = z.infer<typeof ProjectPhaseEnum>;

// Neutral building-type codes. Localized labels are registered per
// jurisdiction on the API (e.g. NL: 'dwelling' -> 'Woning').
export const BuildingTypeEnum = z.enum(['dwelling', 'commercial', 'other']);
export type BuildingTypeValue = z.infer<typeof BuildingTypeEnum>;

export const ProjectRoleEnum = z.enum([
  'owner',
  'editor',
  'viewer',
  'inspector',
  'contractor',
  'client',
]);

export type ProjectRole = z.infer<typeof ProjectRoleEnum>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.union([z.string(), z.null()]),
  thumbnail_url: z.union([z.string(), z.null()]),
  owner_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),

  reference_code: z.union([z.string(), z.null()]),
  lifecycle_state: ProjectLifecycleStateEnum,
  phase: ProjectPhaseEnum,
  // ISO 3166-1 alpha-2. NL today; widens as more jurisdictions register.
  country: z.string().length(2),
  delivery_date: z.union([z.string(), z.null()]),
  planned_start_date: z.union([z.string(), z.null()]),
  building_type: z.union([BuildingTypeEnum, z.null()]),

  street: z.union([z.string(), z.null()]),
  house_number: z.union([z.string(), z.null()]),
  postal_code: z.union([z.string(), z.null()]),
  city: z.union([z.string(), z.null()]),
  municipality: z.union([z.string(), z.null()]),
  bag_id: z.union([z.string(), z.null()]),
  permit_number: z.union([z.string(), z.null()]),

  latitude: z.union([z.number(), z.null()]),
  longitude: z.union([z.number(), z.null()]),

  // The current caller's own role on this project (null when reached via an
  // org-admin/superuser bypass without a membership row). Drives UI gating
  // against the permission matrix. Keep as a plain union (input == output) —
  // never `.default()` — so apiClient response validation round-trips.
  my_role: z.union([ProjectRoleEnum, z.null()]),
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

export type ProjectList = z.infer<typeof ProjectListSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.union([z.string(), z.null()]).optional(),
  thumbnail_url: z.union([z.string(), z.null()]).optional(),
  reference_code: z.union([z.string().max(50), z.null()]).optional(),
  phase: ProjectPhaseEnum.optional(),
  country: z.string().length(2).optional(),
  delivery_date: z.union([z.string(), z.null()]).optional(),
  planned_start_date: z.union([z.string(), z.null()]).optional(),
  building_type: z.union([BuildingTypeEnum, z.null()]).optional(),
  street: z.union([z.string().max(255), z.null()]).optional(),
  house_number: z.union([z.string().max(20), z.null()]).optional(),
  postal_code: z.union([z.string().max(7), z.null()]).optional(),
  city: z.union([z.string().max(255), z.null()]).optional(),
  municipality: z.union([z.string().max(255), z.null()]).optional(),
  bag_id: z.union([z.string().max(50), z.null()]).optional(),
  permit_number: z.union([z.string().max(100), z.null()]).optional(),
  latitude: z.union([z.number().min(-90).max(90), z.null()]).optional(),
  longitude: z.union([z.number().min(-180).max(180), z.null()]).optional(),
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial();

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateSchema>;

// Project Members

export const ProjectMemberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: ProjectRoleEnum,
  created_at: z.string(),
  email: z.string(),
  full_name: z.union([z.string(), z.null()]),
});

export type ProjectMember = z.infer<typeof ProjectMemberSchema>;

export const ProjectMemberListSchema = z.array(ProjectMemberSchema);

export type ProjectMemberList = z.infer<typeof ProjectMemberListSchema>;

export const ProjectMemberCreateSchema = z.object({
  user_id: z.string().uuid(),
  role: ProjectRoleEnum.optional(),
});

export type ProjectMemberCreateInput = z.infer<typeof ProjectMemberCreateSchema>;

export const ProjectMemberUpdateSchema = z.object({
  role: ProjectRoleEnum,
});

export type ProjectMemberUpdateInput = z.infer<typeof ProjectMemberUpdateSchema>;

// Project Invitations

export const ProjectInvitationResponseSchema = z.object({
  email: z.string(),
  role: ProjectRoleEnum,
  project_id: z.string().uuid(),
  scenario: z.string(),
  user_id: z.string().uuid(),
});

export type ProjectInvitationResponse = z.infer<typeof ProjectInvitationResponseSchema>;
