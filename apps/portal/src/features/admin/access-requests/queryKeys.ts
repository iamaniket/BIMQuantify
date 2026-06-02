import type { ListAccessRequestsParams } from '@/lib/api/admin';

export const adminAccessRequestsKey = ['admin', 'access-requests'] as const;

export const adminAccessRequestsListKey = (
  params: ListAccessRequestsParams,
): readonly ['admin', 'access-requests', 'list', ListAccessRequestsParams] =>
  ['admin', 'access-requests', 'list', params] as const;
