import { apiClient, triggerBrowserDownload } from './client';
import {
  AccessRequestApproveResponseSchema,
  AccessRequestListSchema,
  AdminUserListSchema,
  AdminUserReadSchema,
  AuditEntryListSchema,
  OrganizationCreateResponseSchema,
  OrganizationListSchema,
  OrganizationReadSchema,
  type AccessRequestApproveInput,
  type AccessRequestApproveResponse,
  type AccessRequestRead,
  type AdminUserRead,
  type AuditEntry,
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

export type ListOrganizationsParams = {
  status?: string | undefined;
  q?: string | undefined;
  include_deleted?: boolean | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

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

// ----------------------------------------------------------------------------
// Users
// ----------------------------------------------------------------------------

export type ListAdminUsersParams = {
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

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

// ----------------------------------------------------------------------------
// Access requests
// ----------------------------------------------------------------------------

export type ListAccessRequestsParams = {
  status?: string | undefined;
  q?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
};

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
};

export async function listGlobalAuditLog(
  accessToken: string,
  params: ListAuditLogParams = {},
): Promise<AuditEntryList> {
  const query = buildQuery(params);
  return apiClient.get<AuditEntryList>(
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
