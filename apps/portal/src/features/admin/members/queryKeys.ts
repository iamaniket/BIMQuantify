export const orgMembersKey = (
  organizationId: string,
): readonly ['admin', 'organizations', string, 'members'] => ['admin', 'organizations', organizationId, 'members'] as const;
