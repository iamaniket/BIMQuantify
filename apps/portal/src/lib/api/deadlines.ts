import { apiClient } from './client';
import {
  DeadlineListSchema,
  EffectiveDeadlineNotificationSettingsListSchema,
  EffectiveDeadlineNotificationSettingsSchema,
  type DeadlineList,
  type DeadlineNotificationSettingsUpdate,
  type EffectiveDeadlineNotificationSettings,
  type EffectiveDeadlineNotificationSettingsList,
} from './schemas/deadlines';

// ---------------------------------------------------------------------------
// Deadlines (project-level, read-only)
// ---------------------------------------------------------------------------

export async function listDeadlines(
  accessToken: string,
  projectId: string,
): Promise<DeadlineList> {
  return apiClient.get(
    `/projects/${projectId}/deadlines`,
    DeadlineListSchema,
    accessToken,
  );
}

export async function markDeadlineMet(
  accessToken: string,
  projectId: string,
  deadlineId: string,
): Promise<void> {
  await apiClient.patchNoContent(
    `/projects/${projectId}/deadlines/${deadlineId}`,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Deadline notification settings — org defaults
// ---------------------------------------------------------------------------

export async function listOrgDeadlineSettings(
  accessToken: string,
  locale = 'en',
): Promise<EffectiveDeadlineNotificationSettingsList> {
  return apiClient.get(
    `/deadline-notification-settings?locale=${locale}`,
    EffectiveDeadlineNotificationSettingsListSchema,
    accessToken,
  );
}

export async function updateOrgDeadlineSetting(
  accessToken: string,
  deadlineType: string,
  body: DeadlineNotificationSettingsUpdate,
  locale = 'en',
): Promise<EffectiveDeadlineNotificationSettings> {
  return apiClient.patch(
    `/deadline-notification-settings/${deadlineType}?locale=${locale}`,
    body,
    EffectiveDeadlineNotificationSettingsSchema,
    accessToken,
  );
}

// ---------------------------------------------------------------------------
// Deadline notification settings — project overrides
// ---------------------------------------------------------------------------

export async function listProjectDeadlineSettings(
  accessToken: string,
  projectId: string,
  locale = 'en',
): Promise<EffectiveDeadlineNotificationSettingsList> {
  return apiClient.get(
    `/projects/${projectId}/deadline-notification-settings?locale=${locale}`,
    EffectiveDeadlineNotificationSettingsListSchema,
    accessToken,
  );
}

export async function upsertProjectDeadlineSetting(
  accessToken: string,
  projectId: string,
  deadlineType: string,
  body: DeadlineNotificationSettingsUpdate,
  locale = 'en',
): Promise<EffectiveDeadlineNotificationSettings> {
  return apiClient.put<EffectiveDeadlineNotificationSettings>(
    `/projects/${projectId}/deadline-notification-settings/${deadlineType}?locale=${locale}`,
    body,
    EffectiveDeadlineNotificationSettingsSchema,
    accessToken,
  );
}

export async function deleteProjectDeadlineSetting(
  accessToken: string,
  projectId: string,
  deadlineType: string,
): Promise<void> {
  await apiClient.delete(
    `/projects/${projectId}/deadline-notification-settings/${deadlineType}`,
    accessToken,
  );
}
