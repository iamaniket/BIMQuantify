export const orgMembersKey = (
  organizationId: string,
): readonly ['admin', 'organizations', string, 'members'] => ['admin', 'organizations', organizationId, 'members'] as const;

export const selectableOrgMembersKey = (
  organizationId: string,
): readonly ['admin', 'organizations', string, 'selectable-members'] =>
  ['admin', 'organizations', organizationId, 'selectable-members'] as const;
