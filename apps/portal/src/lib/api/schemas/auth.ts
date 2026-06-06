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
  avatar_url: z.union([z.string(), z.null()]).optional(),
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
  seat_limit: z.union([z.number().int(), z.null()]),
  seat_count_used: z.number().int(),
  active_storage_limit_gb: z.union([z.number().int(), z.null()]),
  active_storage_used_gb: z.number(),
  organization_image_url: z.union([z.string(), z.null()]).optional(),
});

export type OrgMembershipBrief = z.infer<typeof OrgMembershipBriefSchema>;

export const AuthMeResponseSchema = z.object({
  user: UserReadSchema,
  active_organization_id: z.union([z.string(), z.null()]),
  memberships: z.array(OrgMembershipBriefSchema),
  pending_invitations_count: z.number().int(),
});

export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const SwitchOrgRequestSchema = z.object({
  organization_id: z.string(),
});

export type SwitchOrgRequest = z.infer<typeof SwitchOrgRequestSchema>;

export const AccessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string(),
});

export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;
