'use client';

import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';

import {
  clearNotifications,
  dismissNotification,
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';
import type {
  NotificationListResponse,
  UnreadCountResponse,
} from '@/lib/api/schemas';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import { notificationsKey, unreadCountKey } from './queryKeys';

export function useNotifications(): UseQueryResult<NotificationListResponse> {
  return useAuthQuery({
    queryKey: notificationsKey,
    queryFn: (accessToken) => listNotifications(accessToken),
  });
}

export function useUnreadCount(): UseQueryResult<UnreadCountResponse> {
  return useAuthQuery({
    queryKey: unreadCountKey,
    queryFn: (accessToken) => getUnreadCount(accessToken),
  });
}

export function useMarkRead(): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => markNotificationRead(accessToken, id),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}

export function useMarkAllRead(): UseMutationResult<void, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => markAllNotificationsRead(accessToken),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}

export function useDismiss(): UseMutationResult<void, Error, string> {
  return useAuthMutation({
    mutationFn: (accessToken, id) => dismissNotification(accessToken, id),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}

export function useClearAll(): UseMutationResult<void, Error, void> {
  return useAuthMutation({
    mutationFn: (accessToken) => clearNotifications(accessToken),
    invalidateKeys: [notificationsKey, unreadCountKey],
  });
}
