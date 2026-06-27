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
  is_active: z.boolean(),
  is_verified: z.boolean(),
  is_superuser: z.boolean(),
  active_organization_id: z.union([z.string(), z.null()]).optional(),
});

export type AdminUserRead = z.infer<typeof AdminUserReadSchema>;

export const AdminUserListSchema = z.array(AdminUserReadSchema);

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
