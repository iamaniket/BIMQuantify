import { z } from 'zod';

// ----------------------------------------------------------------------------
// Organizations
// ----------------------------------------------------------------------------

export const OrganizationReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  schema_name: z.string(),
  status: z.string(),
  seat_limit: z.union([z.number().int(), z.null()]),
  seat_count_used: z.number().int(),
  active_storage_limit_gb: z.union([z.number().int(), z.null()]),
  active_storage_used_gb: z.number(),
  image_url: z.union([z.string(), z.null()]).optional(),
  created_at: z.string(),
  provisioned_at: z.union([z.string(), z.null()]),
  deleted_at: z.union([z.string(), z.null()]),
  // Two-phase deletion: purged_at set once the org is hard-purged (storage wiped
  // + schema dropped); purge_eligible_at = deleted_at + retention window;
  // is_purge_eligible true once a soft-deleted org is past that window.
  purged_at: z.union([z.string(), z.null()]),
  purge_eligible_at: z.union([z.string(), z.null()]),
  is_purge_eligible: z.boolean(),
});

export type OrganizationRead = z.infer<typeof OrganizationReadSchema>;

export const OrganizationListSchema = z.array(OrganizationReadSchema);

export const OrganizationCreateResponseSchema = z.object({
  organization: OrganizationReadSchema,
  admin_user_id: z.string(),
  admin_email: z.string().email(),
  activation_required: z.boolean(),
});

export type OrganizationCreateResponse = z.infer<typeof OrganizationCreateResponseSchema>;

export const OrganizationCreateInputSchema = z.object({
  name: z.string().min(1).max(255),
  admin_email: z.string().email(),
  admin_full_name: z.string().max(255).optional(),
  seat_limit: z.number().int().min(1).max(100_000)
    .nullable()
    .optional(),
  active_storage_limit_gb: z.number().int().min(1)
    .nullable()
    .optional(),
});

export type OrganizationCreateInput = z.infer<typeof OrganizationCreateInputSchema>;

export const OrganizationUpdateInputSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  seat_limit: z.union([z.number().int().min(1).max(100_000), z.null()]).optional(),
  active_storage_limit_gb: z.union([z.number().int().min(1), z.null()]).optional(),
});

export type OrganizationUpdateInput = z.infer<typeof OrganizationUpdateInputSchema>;

// ----------------------------------------------------------------------------
// Users (super-admin global view)
// ----------------------------------------------------------------------------

export const AdminUserReadSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  full_name: z.union([z.string(), z.null()]),
  company: z.union([z.string(), z.null()]).optional(),
  is_active: z.boolean(),
  is_verified: z.boolean(),
  is_superuser: z.boolean(),
  active_organization_id: z.union([z.string(), z.null()]).optional(),
  // Account-creation timestamp (real users.created_at column, API migration 0010).
  created_at: z.string(),
  // H6: the account is currently login-locked (computed server-side from Redis).
  locked: z.boolean(),
});

export type AdminUserRead = z.infer<typeof AdminUserReadSchema>;

export const AdminUserListSchema = z.array(AdminUserReadSchema);

// ----------------------------------------------------------------------------
// Free-tier accounts (super-admin /admin/users/free)
// ----------------------------------------------------------------------------

export const FreeUserUsageSchema = z.object({
  storage_bytes_used: z.number().int(),
  storage_bytes_cap: z.number().int(),
  project_count: z.number().int(),
  project_cap: z.number().int(),
  // `document_count` is the container count (free_documents); the UI labels it
  // "Containers" ("Informatiecontainers" in NL).
  document_count: z.number().int(),
  document_cap: z.number().int(),
  // Per-project invited-member cap (effective: override ?? default).
  member_cap: z.number().int(),
  snag_count: z.number().int(),
  member_of_count: z.number().int(),
  last_activity_at: z.union([z.string(), z.null()]).optional(),
  first_activity_at: z.union([z.string(), z.null()]).optional(),
});

export type FreeUserUsage = z.infer<typeof FreeUserUsageSchema>;

// Effective free-tier limits + trial state for one account, plus the raw
// per-user overrides and env defaults the super-admin edit form needs.
export const FreeUserLimitsSchema = z.object({
  max_projects: z.number().int(),
  max_members_per_project: z.number().int(),
  max_documents: z.number().int(),
  storage_max_bytes: z.number().int(),
  account_max_age_days: z.number().int(),
  expiry_exempt: z.boolean(),
  account_expires_at: z.union([z.string(), z.null()]),
  days_remaining: z.union([z.number().int(), z.null()]),
  expired: z.boolean(),
  override_max_projects: z.union([z.number().int(), z.null()]),
  override_max_members_per_project: z.union([z.number().int(), z.null()]),
  override_max_documents: z.union([z.number().int(), z.null()]),
  override_storage_max_bytes: z.union([z.number().int(), z.null()]),
  override_account_max_age_days: z.union([z.number().int(), z.null()]),
  default_max_projects: z.number().int(),
  default_max_members_per_project: z.number().int(),
  default_max_documents: z.number().int(),
  default_storage_max_bytes: z.number().int(),
  default_account_max_age_days: z.number().int(),
});

export type FreeUserLimits = z.infer<typeof FreeUserLimitsSchema>;

// Body for PATCH /admin/users/free/{id}/limits — full-replace. Each numeric
// field: a positive int to override, or null to clear (fall back to the default).
export type FreeUserLimitsUpdate = {
  max_projects: number | null;
  max_members_per_project: number | null;
  max_documents: number | null;
  storage_max_bytes: number | null;
  account_max_age_days: number | null;
  expiry_exempt: boolean;
};

export const FreeUserReadSchema = AdminUserReadSchema.extend({
  usage: FreeUserUsageSchema,
  limits: FreeUserLimitsSchema,
});

// The caller's OWN free caps + trial countdown (GET /pooled/account/limits) —
// drives the portal trial banner. No override/default internals (admin-only).
export const FreeAccountLimitsSchema = z.object({
  max_projects: z.number().int(),
  max_members_per_project: z.number().int(),
  max_documents: z.number().int(),
  storage_max_bytes: z.number().int(),
  account_max_age_days: z.number().int(),
  account_expires_at: z.union([z.string(), z.null()]),
  days_remaining: z.union([z.number().int(), z.null()]),
  expired: z.boolean(),
  expiry_exempt: z.boolean(),
});

export type FreeAccountLimits = z.infer<typeof FreeAccountLimitsSchema>;

export type FreeUserRead = z.infer<typeof FreeUserReadSchema>;

export const FreeUserListSchema = z.array(FreeUserReadSchema);

export const FreeUserProjectRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.string(),
  document_count: z.number().int(),
  snag_count: z.number().int(),
  storage_bytes: z.number().int(),
});

export const FreeUserDocumentRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  discipline: z.string(),
  file_count: z.number().int(),
  size_bytes: z.number().int(),
  last_viewed_at: z.union([z.string(), z.null()]).optional(),
  pooled_project_id: z.union([z.string(), z.null()]).optional(),
});

export const FreeUserSnagRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  severity: z.string(),
  status: z.string(),
  created_at: z.string(),
});

export const FreeUserSharedRowSchema = z.object({
  pooled_project_id: z.string(),
  name: z.string(),
  owner_email: z.string().email(),
  role: z.string(),
});

export const FreeUserDetailSchema = z.object({
  user: FreeUserReadSchema,
  projects: z.array(FreeUserProjectRowSchema),
  documents: z.array(FreeUserDocumentRowSchema),
  snags: z.array(FreeUserSnagRowSchema),
  shared_projects: z.array(FreeUserSharedRowSchema),
});

export type FreeUserDetail = z.infer<typeof FreeUserDetailSchema>;
export type FreeUserProjectRow = z.infer<typeof FreeUserProjectRowSchema>;
export type FreeUserDocumentRow = z.infer<typeof FreeUserDocumentRowSchema>;
export type FreeUserSnagRow = z.infer<typeof FreeUserSnagRowSchema>;
export type FreeUserSharedRow = z.infer<typeof FreeUserSharedRowSchema>;

// ----------------------------------------------------------------------------
// Members (org-scoped)
// ----------------------------------------------------------------------------

export const MemberReadSchema = z.object({
  user_id: z.string(),
  email: z.string().email(),
  full_name: z.union([z.string(), z.null()]),
  is_org_admin: z.boolean(),
  status: z.string(),
  invited_at: z.string(),
  accepted_at: z.union([z.string(), z.null()]),
  // Pending invitations have an expiry; other statuses are null. Surfaced
  // so the portal can show a countdown / "expired" badge.
  expires_at: z.union([z.string(), z.null()]),
  // When this row is the only surviving admin in the org, destructive
  // actions on it are blocked server-side. Surfaced so the UI can disable
  // the buttons up front instead of waiting for a 409.
  is_last_admin: z.boolean(),
  can_remove: z.boolean(),
  can_demote: z.boolean(),
  can_suspend: z.boolean(),
  // H6: the account is currently login-locked (computed server-side from Redis).
  locked: z.boolean(),
});

export type MemberRead = z.infer<typeof MemberReadSchema>;

// Minimal member projection returned by
// `GET /organizations/{org}/selectable-members` — the member-callable user
// picker (the full `MemberRead` list is org-admin only). `is_org_admin` lets
// the UI hide admins, who are auto-added as project editors on creation.
export const SelectableMemberSchema = z.object({
  user_id: z.string(),
  email: z.string().email(),
  full_name: z.union([z.string(), z.null()]),
  is_org_admin: z.boolean(),
});

export type SelectableMember = z.infer<typeof SelectableMemberSchema>;

export const SelectableMemberListSchema = z.array(SelectableMemberSchema);

// Body for `DELETE /organizations/{org}/members/{user}` — supplied when
// the target user owns one or more projects in the org. The API returns
// `OWNS_ACTIVE_PROJECTS` with the list of project ids when this is
// missing; the portal then prompts the admin to pick a reassign target.
export const MemberDeleteInputSchema = z.object({
  reassign_to: z.string().optional(),
});

export type MemberDeleteInput = z.infer<typeof MemberDeleteInputSchema>;

export const MemberListSchema = z.array(MemberReadSchema);

export const MemberInviteInputSchema = z.object({
  email: z.string().email(),
  full_name: z.string().max(255).optional(),
  is_org_admin: z.boolean().optional(),
  projects: z
    .array(
      z.object({
        project_id: z.string(),
        role: z.string(),
      }),
    )
    .optional(),
});

export type MemberInviteInput = z.infer<typeof MemberInviteInputSchema>;

export const MemberUpdateInputSchema = z.object({
  is_org_admin: z.boolean().optional(),
  status: z.enum(['pending', 'active', 'suspended', 'removed']).optional(),
});

export type MemberUpdateInput = z.infer<typeof MemberUpdateInputSchema>;

// ----------------------------------------------------------------------------
// Access requests (super-admin lead review)
// ----------------------------------------------------------------------------

export const AccessRequestReadSchema = z.object({
  id: z.string(),
  name: z.string(),
  work_email: z.string(),
  company: z.string(),
  role: z.string(),
  company_size: z.string(),
  country: z.string(),
  notes: z.union([z.string(), z.null()]),
  status: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type AccessRequestRead = z.infer<typeof AccessRequestReadSchema>;

export const AccessRequestListSchema = z.array(AccessRequestReadSchema);

export const AccessRequestApproveResponseSchema = z.object({
  access_request: AccessRequestReadSchema,
  organization: OrganizationReadSchema,
  admin_email: z.string().email(),
  activation_required: z.boolean(),
});

export type AccessRequestApproveResponse = z.infer<typeof AccessRequestApproveResponseSchema>;

export type AccessRequestApproveInput = {
  org_name?: string;
  seat_limit?: number | null;
  active_storage_limit_gb?: number | null;
};

// ----------------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------------

export const AuditEntrySchema = z.object({
  id: z.string(),
  user_id: z.union([z.string(), z.null()]),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.union([z.string(), z.null()]),
  before: z.union([z.record(z.unknown()), z.null()]),
  after: z.union([z.record(z.unknown()), z.null()]),
  request_id: z.union([z.string(), z.null()]),
  ip_address: z.union([z.string(), z.null()]),
  user_agent: z.union([z.string(), z.null()]),
  created_at: z.string(),
});

export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditEntryListSchema = z.array(AuditEntrySchema);
