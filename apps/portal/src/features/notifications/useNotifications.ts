'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/lib/api/notifications';
import type {
  NotificationListResponse,
  UnreadCountResponse,
} from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

import { notificationsKey, unreadCountKey } from './queryKeys';

export function useNotifications(): UseQueryResult<NotificationListResponse> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: notificationsKey,
    queryFn: async (): Promise<NotificationListResponse> => {
      if (accessToken === null) throw new Error('Not authenticated');
      return listNotifications(accessToken);
    },
    enabled: accessToken !== null,
  });
}

export function useUnreadCount(): UseQueryResult<UnreadCountResponse> {
  const { tokens } = useAuth();
  const accessToken = tokens === null ? null : tokens.access_token;

  return useQuery({
    queryKey: unreadCountKey,
    queryFn: async (): Promise<UnreadCountResponse> => {
      if (accessToken === null) throw new Error('Not authenticated');
      return getUnreadCount(accessToken);
    },
    enabled: accessToken !== null,
  });
}

export function useMarkRead(): UseMutationResult<void, Error, string> {
  const { tokens } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string): Promise<void> => {
      const accessToken = tokens === null ? null : tokens.access_token;
      if (!accessToken) throw new Error('Not authenticated');
      return markNotificationRead(accessToken, notificationId);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: notificationsKey });
      await qc.invalidateQueries({ queryKey: unreadCountKey });
    },
  });
}

export function useMarkAllRead(): UseMutationResult<void, Error, void> {
  const { tokens } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<void> => {
      const accessToken = tokens === null ? null : tokens.access_token;
      if (!accessToken) throw new Error('Not authenticated');
      return markAllNotificationsRead(accessToken);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: notificationsKey });
      await qc.invalidateQueries({ queryKey: unreadCountKey });
    },
  });
}
