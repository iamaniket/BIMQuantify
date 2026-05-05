import { env } from '@/lib/env';

import { apiClient } from './client';
import {
  NotificationListResponseSchema,
  UnreadCountResponseSchema,
  type NotificationListResponse,
  type UnreadCountResponse,
} from './schemas';

export async function listNotifications(
  accessToken: string,
  limit = 20,
  offset = 0,
): Promise<NotificationListResponse> {
  return apiClient.get<NotificationListResponse>(
    `/notifications?limit=${String(limit)}&offset=${String(offset)}`,
    NotificationListResponseSchema,
    accessToken,
  );
}

export async function getUnreadCount(
  accessToken: string,
): Promise<UnreadCountResponse> {
  return apiClient.get<UnreadCountResponse>(
    '/notifications/unread-count',
    UnreadCountResponseSchema,
    accessToken,
  );
}

export async function markNotificationRead(
  accessToken: string,
  notificationId: string,
): Promise<void> {
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/notifications/${notificationId}/read`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to mark notification read: ${String(response.status)}`);
  }
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<void> {
  const response = await fetch(
    `${env.NEXT_PUBLIC_API_URL}/notifications/mark-all-read`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  if (!response.ok) {
    throw new Error(`Failed to mark all notifications read: ${String(response.status)}`);
  }
}
