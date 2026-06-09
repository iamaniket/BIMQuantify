import { apiClient } from './client';
import {
  DeadlineListSchema,
  DeadlineReadinessSchema,
  DeadlineSchema,
  EffectiveDeadlineNotificationSettingsListSchema,
  EffectiveDeadlineNotificationSettingsSchema,
  type Deadline,
  type DeadlineList,
  type DeadlineNotificationSettingsUpdate,
  type DeadlineReadiness,
  type EffectiveDeadlineNotificationSettings,
  type EffectiveDeadlineNotificationSettingsList,
  type FileDeadlineBody,
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

export async function fileDeadline(
  accessToken: string,
  projectId: string,
  deadlineId: string,
  body: FileDeadlineBody = {},
): Promise<Deadline> {
  return apiClient.patch(
    `/projects/${projectId}/deadlines/${deadlineId}`,
    body,
    DeadlineSchema,
    accessToken,
  );
}

export async function getDeadlineReadiness(
  accessToken: string,
  projectId: string,
  deadlineId: string,
): Promise<DeadlineReadiness> {
  return apiClient.get(
    `/projects/${projectId}/deadlines/${deadlineId}/readiness`,
    DeadlineReadinessSchema,
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
