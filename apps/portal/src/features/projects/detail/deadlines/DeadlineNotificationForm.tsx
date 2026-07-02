'use client';

import { useTranslations } from 'next-intl';
import { useCallback, type JSX } from 'react';

import { Badge, Button } from '@bimdossier/ui';

import type {
  DeadlineNotificationSettingsUpdate,
  EffectiveDeadlineNotificationSettings,
} from '@/lib/api/schemas/deadlines';

const REMINDER_DAY_OPTIONS = [1, 3, 7, 14, 21, 30] as const;
const ROLE_OPTIONS = ['owner', 'editor', 'viewer', 'inspector', 'contractor', 'client'] as const;

// ---------------------------------------------------------------------------
// SettingRow (defined before usage to satisfy no-use-before-define)
// ---------------------------------------------------------------------------

function sourceLabel(
  source: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === 'project_override') return t('sourceProject');
  if (source === 'org_default') return t('sourceOrg');
  return t('sourceDefault');
}

function SettingRow({
  setting,
  onUpdate,
  onRevert,
  isUpdating,
  showRevert,
}: {
  setting: EffectiveDeadlineNotificationSettings;
  onUpdate: (
    deadlineType: string,
    body: DeadlineNotificationSettingsUpdate,
  ) => void;
  onRevert: ((deadlineType: string) => void) | undefined;
  isUpdating: boolean;
  showRevert: boolean;
}): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines.notifications');
  const tRoles = useTranslations('projectAccess.table.roles');

  const toggleEnabled = useCallback(() => {
    onUpdate(setting.deadline_type, { enabled: !setting.enabled });
  }, [onUpdate, setting.deadline_type, setting.enabled]);

  const toggleDay = useCallback(
    (day: number) => {
      const current = new Set(setting.reminder_days);
      if (current.has(day)) {
        current.delete(day);
      } else {
        current.add(day);
      }
      const sorted = [...current].sort((a, b) => b - a);
      if (sorted.length > 0) {
        onUpdate(setting.deadline_type, { reminder_days: sorted });
      }
    },
    [onUpdate, setting.deadline_type, setting.reminder_days],
  );

  const toggleRole = useCallback(
    (role: string) => {
      const current = new Set(setting.recipient_roles);
      if (current.has(role)) {
        current.delete(role);
      } else {
        current.add(role);
      }
      const arr = [...current];
      if (arr.length > 0) {
        onUpdate(setting.deadline_type, { recipient_roles: arr });
      }
    },
    [onUpdate, setting.deadline_type, setting.recipient_roles],
  );

  const chipClass = (active: boolean): string => {
    if (active) {
      return 'border-primary bg-primary-lighter text-primary';
    }
    return 'border-border bg-background text-foreground-tertiary hover:border-foreground-tertiary';
  };

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-body3 font-semibold">{setting.label}</span>
          <Badge variant="default" className="text-caption">
            {sourceLabel(setting.source, t)}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {showRevert && setting.source === 'project_override' && onRevert !== undefined && (
            <Button
              variant="border"
              size="md"
              disabled={isUpdating}
              onClick={() => { onRevert(setting.deadline_type); }}
            >
              {t('revertToDefaults')}
            </Button>
          )}
          <button
            type="button"
            disabled={isUpdating}
            onClick={toggleEnabled}
            className={`relative h-5 w-9 rounded-full transition-colors ${
              setting.enabled ? 'bg-primary' : 'bg-foreground-tertiary/30'
            }`}
            aria-label={setting.enabled ? t('disable') : t('enable')}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                setting.enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {setting.enabled && (
        <div className="mt-3 space-y-3">
          <div>
            <div className="mb-1.5 text-caption font-medium text-foreground-secondary">
              {t('reminderDays')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {REMINDER_DAY_OPTIONS.map((day) => {
                const active = setting.reminder_days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    disabled={isUpdating}
                    onClick={() => { toggleDay(day); }}
                    className={`rounded-full border px-2.5 py-0.5 text-caption font-medium transition-colors ${chipClass(active)}`}
                  >
                    {t('daysBefore', { days: day })}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-caption font-medium text-foreground-secondary">
              {t('recipientRoles')}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ROLE_OPTIONS.map((role) => {
                const active = setting.recipient_roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    disabled={isUpdating}
                    onClick={() => { toggleRole(role); }}
                    className={`rounded-full border px-2.5 py-0.5 text-caption font-medium transition-colors ${chipClass(active)}`}
                  >
                    {tRoles(role)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main form
// ---------------------------------------------------------------------------

type Props = {
  settings: EffectiveDeadlineNotificationSettings[];
  onUpdate: (
    deadlineType: string,
    body: DeadlineNotificationSettingsUpdate,
  ) => void;
  onRevert: ((deadlineType: string) => void) | undefined;
  isUpdating: boolean;
  showRevert: boolean;
  /** Suppress the form's own title/description heading — used when the host
   * (e.g. the notification-settings dialog) already provides one. */
  hideHeader?: boolean;
};

export function DeadlineNotificationForm({
  settings,
  onUpdate,
  onRevert,
  isUpdating,
  showRevert,
  hideHeader = false,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.tabs.deadlines.notifications');

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <>
          <div className="text-body3 font-semibold text-foreground">
            {t('title')}
          </div>
          <div className="text-caption text-foreground-tertiary">
            {t('description')}
          </div>
        </>
      )}

      {settings.map((s) => (
        <SettingRow
          key={s.deadline_type}
          setting={s}
          onUpdate={onUpdate}
          onRevert={onRevert}
          isUpdating={isUpdating}
          showRevert={showRevert}
        />
      ))}
    </div>
  );
}
