import type { ListAdminUsersParams } from '@/lib/api/admin';

export const adminUsersKey = ['admin', 'users'] as const;

export const adminUsersListKey = (
  params: ListAdminUsersParams,
): readonly ['admin', 'users', 'list', ListAdminUsersParams] => ['admin', 'users', 'list', params] as const;
