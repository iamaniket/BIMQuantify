import { z } from 'zod';

export const InvitationReadSchema = z.object({
  organization_id: z.string(),
  organization_name: z.string(),
  is_org_admin: z.boolean(),
  invited_at: z.string(),
  expires_at: z.string(),
  invited_by_email: z.union([z.string(), z.null()]),
});

export type InvitationRead = z.infer<typeof InvitationReadSchema>;

export const InvitationListSchema = z.array(InvitationReadSchema);

export const InvitationAcceptResponseSchema = z.object({
  organization_id: z.string(),
  status: z.string(),
  accepted_at: z.string(),
});

export type InvitationAcceptResponse = z.infer<typeof InvitationAcceptResponseSchema>;
