import { apiClient, triggerBrowserDownload, type PaginatedResponse } from './client';
import {
  AccessRequestApproveResponseSchema,
  AccessRequestListSchema,
  AdminUserListSchema,
  AdminUserReadSchema,
  AuditEntryListSchema,
  FreeUserDetailSchema,
  FreeUserListSchema,
  OrganizationCreateResponseSchema,
  OrganizationListSchema,
  OrganizationReadSchema,
  type AccessRequestApproveInput,
  type AccessRequestApproveResponse,
  type AccessRequestRead,
  type AdminUserRead,
  type AuditEntry,
  type FreeUserDetail,
  type FreeUserRead,
  type OrganizationCreateInput,
  type OrganizationCreateResponse,
  type OrganizationRead,
  type OrganizationUpdateInput,
} from './schemas';

export type AdminUserList = AdminUserRead[];
export type AuditEntryList = AuditEntry[];

// ----------------------------------------------------------------------------
// Organizations
// ----------------------------------------------------------------------------

/** Shared server-side sort params for paginated list endpoints. */
export type SortQueryParams = {
  order_by?: string | undefined;
  order_dir?: 'asc' | 'desc' | undefined;
};

export type ListOrganizationsParams = {
  status?: string | undefined;
  q?: string | undefined;
  include_deleted?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

function buildQuery(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined) return;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  });
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
}

export async function listOrganizations(
  accessToken: string,
  params: ListOrganizationsParams = {},
): Promise<OrganizationRead[]> {
  const query = buildQuery(params);
  return apiClient.get<OrganizationRead[]>(
    `/admin/organizations${query}`,
    OrganizationListSchema,
    accessToken,
  );
}

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listOrganizationsPage(
  accessToken: string,
  params: ListOrganizationsParams = {},
): Promise<PaginatedResponse<OrganizationRead[]>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<OrganizationRead[]>(
    `/admin/organizations${query}`,
    OrganizationListSchema,
    accessToken,
  );
}

export async function getOrganization(
  accessToken: string,
  id: string,
): Promise<OrganizationRead> {
  return apiClient.get<OrganizationRead>(
    `/admin/organizations/${id}`,
    OrganizationReadSchema,
    accessToken,
  );
}

export async function createOrganization(
  accessToken: string,
  input: OrganizationCreateInput,
): Promise<OrganizationCreateResponse> {
  return apiClient.post<OrganizationCreateResponse>(
    '/admin/organizations',
    input,
    OrganizationCreateResponseSchema,
    accessToken,
  );
}

export async function updateOrganization(
  accessToken: string,
  id: string,
  input: OrganizationUpdateInput,
): Promise<OrganizationRead> {
  return apiClient.patch<OrganizationRead>(
    `/admin/organizations/${id}`,
    input,
    OrganizationReadSchema,
    accessToken,
  );
}

export async function deleteOrganization(
  accessToken: string,
  id: string,
): Promise<void> {
  return apiClient.delete(`/admin/organizations/${id}`, accessToken);
}

/**
 * Hard-purge a soft-deleted org (phase 2): wipes its storage + DROPs its tenant
 * schema. Only succeeds once the org is past the retention window (the server
 * returns 409 ORG_PURGE_NOT_DUE otherwise). Super-admin only.
 */
export async function purgeOrganization(
  accessToken: string,
  id: string,
): Promise<OrganizationRead> {
  return apiClient.post<OrganizationRead>(
    `/admin/organizations/${id}/purge`,
    undefined,
    OrganizationReadSchema,
    accessToken,
  );
}

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

export type ListAdminUsersParams = {
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

export async function listAdminUsers(
  accessToken: string,
  params: ListAdminUsersParams = {},
): Promise<AdminUserList> {
  const query = buildQuery(params);
  return apiClient.get<AdminUserList>(
    `/admin/users${query}`,
    AdminUserListSchema,
    accessToken,
  );
}

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listAdminUsersPage(
  accessToken: string,
  params: ListAdminUsersParams = {},
): Promise<PaginatedResponse<AdminUserList>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<AdminUserList>(
    `/admin/users${query}`,
    AdminUserListSchema,
    accessToken,
  );
}

/**
 * Look up a user by exact (case-insensitive) email. Returns null if no user
 * matches. Used by the create-tenant flow to detect when the proposed admin
 * is an existing account, so the form can pre-fill their name and warn the
 * super-admin that they're attaching rather than creating.
 */
export async function lookupUserByEmail(
  accessToken: string,
  email: string,
): Promise<AdminUserRead | null> {
  const trimmed = email.trim().toLowerCase();
  if (trimmed.length === 0) return null;
  // The list endpoint searches with case-insensitive LIKE — we filter the
  // results for an exact match locally so partial matches don't pollute.
  const results = await listAdminUsers(accessToken, { q: trimmed, limit: 5 });
  return results.find((u) => u.email.toLowerCase() === trimmed) ?? null;
}

export async function promoteUser(
  accessToken: string,
  userId: string,
): Promise<AdminUserRead> {
  return apiClient.post<AdminUserRead>(
    `/admin/users/${userId}/promote`,
    undefined,
    AdminUserReadSchema,
    accessToken,
  );
}

export async function demoteUser(
  accessToken: string,
  userId: string,
): Promise<AdminUserRead> {
  return apiClient.post<AdminUserRead>(
    `/admin/users/${userId}/demote`,
    undefined,
    AdminUserReadSchema,
    accessToken,
  );
}

export async function activateUser(
  accessToken: string,
  userId: string,
): Promise<AdminUserRead> {
  return apiClient.post<AdminUserRead>(
    `/admin/users/${userId}/activate`,
    undefined,
    AdminUserReadSchema,
    accessToken,
  );
}

export async function deactivateUser(
  accessToken: string,
  userId: string,
): Promise<AdminUserRead> {
  return apiClient.post<AdminUserRead>(
    `/admin/users/${userId}/deactivate`,
    undefined,
    AdminUserReadSchema,
    accessToken,
  );
}

export async function unlockUser(
  accessToken: string,
  userId: string,
): Promise<AdminUserRead> {
  // H6: clear an account's failed-login lockout. Super-admin only.
  return apiClient.post<AdminUserRead>(
    `/admin/users/${userId}/unlock`,
    undefined,
    AdminUserReadSchema,
    accessToken,
  );
}

// ----------------------------------------------------------------------------
// Free-tier accounts (super-admin)
// ----------------------------------------------------------------------------

export type ListFreeUsersParams = {
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

/** Paginated list of org-less free users + their usage (X-Total-Count). */
export async function listFreeUsersPage(
  accessToken: string,
  params: ListFreeUsersParams = {},
): Promise<PaginatedResponse<FreeUserRead[]>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<FreeUserRead[]>(
    `/admin/users/free${query}`,
    FreeUserListSchema,
    accessToken,
  );
}

/** Drill-down for one free user: usage + their projects/containers/findings/shared. */
export async function getFreeUserDetail(
  accessToken: string,
  userId: string,
): Promise<FreeUserDetail> {
  return apiClient.get<FreeUserDetail>(
    `/admin/users/free/${userId}`,
    FreeUserDetailSchema,
    accessToken,
  );
}

/** Anonymize-in-place (GDPR erasure): scrubs PII + disables auth. Super-admin. */
export async function deleteUser(accessToken: string, userId: string): Promise<void> {
  return apiClient.delete(`/users/${userId}`, accessToken);
}

/** Email a password-reset link on the user's behalf (202). */
export async function sendPasswordReset(
  accessToken: string,
  userId: string,
): Promise<void> {
  return apiClient.postNoContent(
    `/admin/users/${userId}/send-password-reset`,
    accessToken,
  );
}

/** Re-send the activation email to an unverified user (202). */
export async function resendActivation(
  accessToken: string,
  userId: string,
): Promise<void> {
  return apiClient.postNoContent(
    `/admin/users/${userId}/resend-activation`,
    accessToken,
  );
}

// ----------------------------------------------------------------------------
// Access requests
// ----------------------------------------------------------------------------

export type ListAccessRequestsParams = {
  status?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

export async function listAccessRequests(
  accessToken: string,
  params: ListAccessRequestsParams = {},
): Promise<AccessRequestRead[]> {
  const query = buildQuery(params);
  return apiClient.get<AccessRequestRead[]>(
    `/admin/access-requests${query}`,
    AccessRequestListSchema,
    accessToken,
  );
}

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listAccessRequestsPage(
  accessToken: string,
  params: ListAccessRequestsParams = {},
): Promise<PaginatedResponse<AccessRequestRead[]>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<AccessRequestRead[]>(
    `/admin/access-requests${query}`,
    AccessRequestListSchema,
    accessToken,
  );
}

export async function approveAccessRequest(
  accessToken: string,
  id: string,
  input: AccessRequestApproveInput = {},
): Promise<AccessRequestApproveResponse> {
  return apiClient.post<AccessRequestApproveResponse>(
    `/admin/access-requests/${id}/approve`,
    input,
    AccessRequestApproveResponseSchema,
    accessToken,
  );
}

export async function rejectAccessRequest(
  accessToken: string,
  id: string,
): Promise<AccessRequestRead> {
  return apiClient.post<AccessRequestRead>(
    `/admin/access-requests/${id}/reject`,
    undefined,
    AccessRequestListSchema.element,
    accessToken,
  );
}

export async function exportAccessRequests(
  accessToken: string,
  params: ListAccessRequestsParams = {},
): Promise<void> {
  const query = buildQuery(params);
  const { blob, filename } = await apiClient.getBlob(
    `/admin/access-requests/export${query}`,
    accessToken,
  );
  triggerBrowserDownload(blob, filename ?? 'access-requests.csv');
}

// ----------------------------------------------------------------------------
// Audit log
// ----------------------------------------------------------------------------

export type ListAuditLogParams = {
  action?: string | undefined;
  resource_type?: string | undefined;
  resource_id?: string | undefined;
  user_id?: string | undefined;
  organization_id?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
} & SortQueryParams;

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listGlobalAuditLogPage(
  accessToken: string,
  params: ListAuditLogParams = {},
): Promise<PaginatedResponse<AuditEntryList>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<AuditEntryList>(
    `/admin/audit-log${query}`,
    AuditEntryListSchema,
    accessToken,
  );
}

export async function listOrgAuditLog(
  accessToken: string,
  organizationId: string,
  params: Omit<ListAuditLogParams, 'organization_id'> = {},
): Promise<AuditEntryList> {
  const query = buildQuery(params);
  return apiClient.get<AuditEntryList>(
    `/organizations/${organizationId}/audit-log${query}`,
    AuditEntryListSchema,
    accessToken,
  );
}

/** Paginated variant — returns the page items plus the total (X-Total-Count). */
export async function listOrgAuditLogPage(
  accessToken: string,
  organizationId: string,
  params: Omit<ListAuditLogParams, 'organization_id'> = {},
): Promise<PaginatedResponse<AuditEntryList>> {
  const query = buildQuery(params);
  return apiClient.getWithMeta<AuditEntryList>(
    `/organizations/${organizationId}/audit-log${query}`,
    AuditEntryListSchema,
    accessToken,
  );
}
