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
  return apiClient.patchNoContent(`/notifications/${notificationId}/read`, accessToken);
}

export async function markAllNotificationsRead(
  accessToken: string,
): Promise<void> {
  return apiClient.postNoContent('/notifications/mark-all-read', accessToken);
}
