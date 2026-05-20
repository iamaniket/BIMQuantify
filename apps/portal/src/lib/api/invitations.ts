import { apiClient } from './client';
import {
  InvitationAcceptResponseSchema,
  InvitationListSchema,
  type InvitationAcceptResponse,
  type InvitationRead,
} from './schemas';

export async function listMyInvitations(accessToken: string): Promise<InvitationRead[]> {
  return apiClient.get<InvitationRead[]>('/me/invitations', InvitationListSchema, accessToken);
}

export async function acceptInvitation(
  accessToken: string,
  organizationId: string,
): Promise<InvitationAcceptResponse> {
  return apiClient.post<InvitationAcceptResponse>(
    `/me/invitations/${organizationId}/accept`,
    undefined,
    InvitationAcceptResponseSchema,
    accessToken,
  );
}

export async function declineInvitation(
  accessToken: string,
  organizationId: string,
): Promise<void> {
  return apiClient.postNoContent(`/me/invitations/${organizationId}/decline`, accessToken);
}
