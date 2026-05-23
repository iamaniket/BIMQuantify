import type {
  UseQueryResult,
  UseMutationResult,
} from '@tanstack/react-query';
import { useLocale } from 'next-intl';

import {
  deleteProjectDeadlineSetting,
  listOrgDeadlineSettings,
  listProjectDeadlineSettings,
  updateOrgDeadlineSetting,
  upsertProjectDeadlineSetting,
} from '@/lib/api/deadlines';
import type {
  DeadlineNotificationSettingsUpdate,
  EffectiveDeadlineNotificationSettings,
  EffectiveDeadlineNotificationSettingsList,
} from '@/lib/api/schemas/deadlines';
import { useAuthMutation, useAuthQuery } from '@/lib/query/useAuthQuery';

import {
  orgDeadlineSettingsKey,
  projectDeadlineSettingsKey,
} from '../../queryKeys';

// -----------------------------------------------------------------------
// Shared types
// -----------------------------------------------------------------------

type SettingsListResult =
  UseQueryResult<EffectiveDeadlineNotificationSettingsList>;

type UpdateVars = {
  deadlineType: string;
  body: DeadlineNotificationSettingsUpdate;
};

type UpdateResult = UseMutationResult<
  EffectiveDeadlineNotificationSettings, Error, UpdateVars
>;

// -----------------------------------------------------------------------
// Org-level defaults
// -----------------------------------------------------------------------

export function useOrgDeadlineSettings(): SettingsListResult {
  const locale = useLocale();
  return useAuthQuery({
    queryKey: [...orgDeadlineSettingsKey, locale] as const,
    queryFn: (token) => listOrgDeadlineSettings(token, locale),
  });
}

export function useUpdateOrgDeadlineSetting(): UpdateResult {
  const locale = useLocale();
  return useAuthMutation({
    mutationFn: (token, { deadlineType, body }) => (
      updateOrgDeadlineSetting(token, deadlineType, body, locale)
    ),
    invalidateKeys: () => [orgDeadlineSettingsKey],
  });
}

// -----------------------------------------------------------------------
// Project-level overrides
// -----------------------------------------------------------------------

export function useProjectDeadlineSettings(
  projectId: string,
): SettingsListResult {
  const locale = useLocale();
  return useAuthQuery({
    queryKey: [
      ...projectDeadlineSettingsKey(projectId), locale,
    ] as const,
    queryFn: (token) => (
      listProjectDeadlineSettings(token, projectId, locale)
    ),
  });
}

export function useUpsertProjectDeadlineSetting(
  projectId: string,
): UpdateResult {
  const locale = useLocale();
  return useAuthMutation({
    mutationFn(token, { deadlineType, body }) {
      return upsertProjectDeadlineSetting(token, projectId, deadlineType, body, locale);
    },
    invalidateKeys: () => [projectDeadlineSettingsKey(projectId)],
  });
}

export function useDeleteProjectDeadlineSetting(
  projectId: string,
): UseMutationResult<void, Error, { deadlineType: string }> {
  return useAuthMutation({
    mutationFn: (token, { deadlineType }) => (
      deleteProjectDeadlineSetting(token, projectId, deadlineType)
    ),
    invalidateKeys: () => [projectDeadlineSettingsKey(projectId)],
  });
}
