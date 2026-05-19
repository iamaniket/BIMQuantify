import { apiClient } from './client';
import {
  MemberListSchema,
  MemberReadSchema,
  type MemberInviteInput,
  type MemberRead,
  type MemberUpdateInput,
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
): Promise<void> {
  return apiClient.delete(
    `/organizations/${organizationId}/members/${userId}`,
    accessToken,
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
