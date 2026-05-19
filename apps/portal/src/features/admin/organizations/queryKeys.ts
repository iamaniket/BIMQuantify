import type { ListOrganizationsParams } from '@/lib/api/admin';

export const adminOrganizationsKey = ['admin', 'organizations'] as const;

export const adminOrganizationsListKey = (
  params: ListOrganizationsParams,
): readonly ['admin', 'organizations', 'list', ListOrganizationsParams] => ['admin', 'organizations', 'list', params] as const;

export const adminOrganizationKey = (
  id: string,
): readonly ['admin', 'organizations', string] => ['admin', 'organizations', id] as const;
