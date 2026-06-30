import { apiClient } from './client';
import { freePrefix } from './scope';
import {
  NotificationListResponseSchema,
  UnreadCountResponseSchema,
  type NotificationListResponse,
  type UnreadCountResponse,
} from './schemas';

// Free (org-less) callers route to `/pooled/notifications`, paid to `/notifications`.
// Both return the IDENTICAL paid schema — the backend emits the paid shape for free
// (sentinel org, free ids as project/file, null job_id) — so the bell renders
// unchanged. Pass `free` from `useIsFreeContext`.
const base = (free: boolean): string => `${freePrefix(free)}/notifications`;

export async function listNotifications(
  accessToken: string,
  limit = 20,
  offset = 0,
  free = false,
): Promise<NotificationListResponse> {
  return apiClient.get<NotificationListResponse>(
    `${base(free)}?limit=${String(limit)}&offset=${String(offset)}`,
    NotificationListResponseSchema,
    accessToken,
  );
}

export async function getUnreadCount(
  accessToken: string,
  free = false,
): Promise<UnreadCountResponse> {
  return apiClient.get<UnreadCountResponse>(
    `${base(free)}/unread-count`,
    UnreadCountResponseSchema,
    accessToken,
  );
}

export async function markAllNotificationsRead(
  accessToken: string,
  free = false,
): Promise<void> {
  return apiClient.postNoContent(`${base(free)}/mark-all-read`, accessToken);
}

export async function dismissNotification(
  accessToken: string,
  notificationId: string,
  free = false,
): Promise<void> {
  return apiClient.postNoContent(`${base(free)}/${notificationId}/dismiss`, accessToken);
}

export async function clearNotifications(accessToken: string, free = false): Promise<void> {
  return apiClient.postNoContent(`${base(free)}/clear`, accessToken);
}
