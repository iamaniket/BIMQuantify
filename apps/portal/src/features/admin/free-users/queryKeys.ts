import type { ListFreeUsersParams } from '@/lib/api/admin';

export const adminFreeUsersKey = ['admin', 'free-users'] as const;

export const adminFreeUsersListKey = (
  params: ListFreeUsersParams,
): readonly ['admin', 'free-users', 'list', ListFreeUsersParams] =>
  ['admin', 'free-users', 'list', params] as const;

export const adminFreeUserDetailKey = (
  userId: string,
): readonly ['admin', 'free-users', 'detail', string] =>
  ['admin', 'free-users', 'detail', userId] as const;
