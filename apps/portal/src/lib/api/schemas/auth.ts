import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().email(),
  password: z.string().min(1),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const TokenPairSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  token_type: z.string().min(1),
});

export type TokenPair = z.infer<typeof TokenPairSchema>;

export const UserReadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  is_verified: z.boolean(),
  full_name: z.union([z.string(), z.null()]),
  active_organization_id: z.union([z.string(), z.null()]).optional(),
});

export type UserRead = z.infer<typeof UserReadSchema>;

// ----------------------------------------------------------------------------
// /auth/me memberships + /auth/switch-organization
// ----------------------------------------------------------------------------

export const OrgMembershipBriefSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  organization_status: z.string(),
  is_org_admin: z.boolean(),
  member_status: z.string(),
});

export type OrgMembershipBrief = z.infer<typeof OrgMembershipBriefSchema>;

export const AuthMeResponseSchema = z.object({
  user: UserReadSchema,
  active_organization_id: z.union([z.string(), z.null()]),
  memberships: z.array(OrgMembershipBriefSchema),
});

export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const SwitchOrgRequestSchema = z.object({
  organization_id: z.string(),
});

export type SwitchOrgRequest = z.infer<typeof SwitchOrgRequestSchema>;
