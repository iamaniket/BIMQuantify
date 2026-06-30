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
  // The org's entitlement/plan (the TIER axis, distinct from ISOLATION). Optional
  // so older responses / test mocks still parse; consumers default to 'paid'.
  plan: z.string().optional(),
});

export type OrgMembershipBrief = z.infer<typeof OrgMembershipBriefSchema>;

export const AuthMeResponseSchema = z.object({
  user: UserReadSchema,
  active_organization_id: z.union([z.string(), z.null()]),
  memberships: z.array(OrgMembershipBriefSchema),
  pending_invitations_count: z.number().int(),
  // True when the user owns or is a member of ≥1 free project — drives whether
  // the org switcher shows a "Free workspace" entry. Optional so older server
  // responses (and test mocks) still parse; consumers read it as `?? false`.
  has_free_workspace: z.boolean().optional(),
  // The acting principal's PLAN (entitlement) for the active scope: 'free' when
  // org-less, else the active org's plan. The read-only TIER signal the UI gates
  // on — ORTHOGONAL to the isolation surface (active_organization_id). Optional
  // for back-compat; consumers default to 'free'.
  plan: z.string().optional(),
});

export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

export const SwitchOrgRequestSchema = z.object({
  organization_id: z.string(),
});

export type SwitchOrgRequest = z.infer<typeof SwitchOrgRequestSchema>;

export const AccessTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  // Present since refresh-token rotation: every /auth/jwt/refresh returns a NEW
  // refresh token that the client MUST adopt (the presented one is retired, and
  // replaying it later trips reuse detection). Optional so a non-rotating server
  // still parses.
  refresh_token: z.string().min(1).optional(),
  token_type: z.string(),
});

export type AccessTokenResponse = z.infer<typeof AccessTokenResponseSchema>;
