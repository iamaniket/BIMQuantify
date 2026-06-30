'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import { useIsPooledContext } from '@/hooks/useIsPooledContext';
import {
  clearNotifications,
  dismissNotification,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
} from '@/lib/api/notifications';
import type {
  NotificationListResponse,
  UnreadCountResponse,
} from '@/lib/api/schemas';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { notificationsKey, unreadCountKey } from './queryKeys';

const POLL_FALLBACK_MS = 30_000;

// The bell mounts for everyone; each hook passes the free flag so an org-less
// caller routes to `/pooled/notifications` (vs the org-scoped paid feed). Same query
// keys for both → the WS invalidation in useNotificationSocket is unchanged.
// Queries wait on `ready` so a free user never briefly hits the org-only paid
// endpoint before /auth/me resolves.

export function useNotifications(): UseQueryResult<NotificationListResponse> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: notificationsKey,
    queryFn: (accessToken) => listNotifications(accessToken, 20, 0, isPooled),
    refetchInterval: POLL_FALLBACK_MS,
    enabled: ready,
  });
}

export function useUnreadCount(): UseQueryResult<UnreadCountResponse> {
  const { isPooled, ready } = useIsPooledContext();
  return useAuthQuery({
    queryKey: unreadCountKey,
    queryFn: (accessToken) => getUnreadCount(accessToken, isPooled),
    refetchInterval: POLL_FALLBACK_MS,
    enabled: ready,
  });
}

export function useMarkAllRead(): UseMutationResult<void, Error, void> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken) => markAllNotificationsRead(accessToken, isPooled),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}

export function useDismiss(): UseMutationResult<void, Error, string> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken, id) => dismissNotification(accessToken, id, isPooled),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}

export function useClearAll(): UseMutationResult<void, Error, void> {
  const { isPooled } = useIsPooledContext();
  return useAuthMutation({
    mutationFn: (accessToken) => clearNotifications(accessToken, isPooled),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}
