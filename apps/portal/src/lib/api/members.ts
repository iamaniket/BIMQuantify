import { apiClient } from './client';
import {
  MemberListSchema,
  MemberReadSchema,
  SelectableMemberListSchema,
  type MemberDeleteInput,
  type MemberInviteInput,
  type MemberRead,
  type MemberUpdateInput,
  type SelectableMember,
} from './schemas';

export type ListMembersParams = {
  status?: string | undefined;
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

export async function listMembers(
  accessToken: string,
  organizationId: string,
  params: ListMembersParams = {},
): Promise<MemberRead[]> {
  const query = buildQuery(params);
  return apiClient.get<MemberRead[]>(
    `/organizations/${organizationId}/members${query}`,
    MemberListSchema,
    accessToken,
  );
}

/** Active, non-guest members of the org for "add member" pickers. Callable
 * by any active member (unlike `listMembers`, which is org-admin only). */
export async function listSelectableMembers(
  accessToken: string,
  organizationId: string,
): Promise<SelectableMember[]> {
  return apiClient.get<SelectableMember[]>(
    `/organizations/${organizationId}/selectable-members`,
    SelectableMemberListSchema,
    accessToken,
  );
}

export async function inviteMember(
  accessToken: string,
  organizationId: string,
  input: MemberInviteInput,
): Promise<MemberRead> {
  return apiClient.post<MemberRead>(
    `/organizations/${organizationId}/members`,
    input,
    MemberReadSchema,
    accessToken,
  );
}

export async function updateMember(
  accessToken: string,
  organizationId: string,
  userId: string,
  input: MemberUpdateInput,
): Promise<MemberRead> {
  return apiClient.patch<MemberRead>(
    `/organizations/${organizationId}/members/${userId}`,
    input,
    MemberReadSchema,
    accessToken,
  );
}

export async function removeMember(
  accessToken: string,
  organizationId: string,
  userId: string,
  input?: MemberDeleteInput,
): Promise<void> {
  return apiClient.delete(
    `/organizations/${organizationId}/members/${userId}`,
    accessToken,
    input,
  );
}

export async function leaveOrganization(
  accessToken: string,
  organizationId: string,
  input?: { reassign_to?: string },
): Promise<void> {
  return apiClient.postNoContent(
    `/me/memberships/${organizationId}/leave`,
    accessToken,
    input,
  );
}

export async function resendInvite(
  accessToken: string,
  organizationId: string,
  userId: string,
): Promise<void> {
  return apiClient.postNoContent(
    `/organizations/${organizationId}/members/${userId}/resend-invite`,
    accessToken,
  );
}
