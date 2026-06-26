'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';

import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimdossier/ui';
import { Settings } from '@bimdossier/ui/icons';

import type {
  DeadlineNotificationSettingsUpdate,
  EffectiveDeadlineNotificationSettings,
} from '@/lib/api/schemas/deadlines';

import { DeadlineNotificationForm } from './deadlines/DeadlineNotificationForm';
import {
  useDeleteProjectDeadlineSetting,
  useProjectDeadlineSettings,
  useUpsertProjectDeadlineSetting,
} from './deadlines/useDeadlineNotificationSettings';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
};

function hasSettingChanged(
  original: EffectiveDeadlineNotificationSettings,
  local: EffectiveDeadlineNotificationSettings,
): boolean {
  if (original.enabled !== local.enabled) return true;
  if (original.reminder_days.length !== local.reminder_days.length) return true;
  for (let i = 0; i < original.reminder_days.length; i++) {
    if (original.reminder_days[i] !== local.reminder_days[i]) return true;
  }
  if (original.recipient_roles.length !== local.recipient_roles.length) return true;
  const origRoles = new Set(original.recipient_roles);
  for (const role of local.recipient_roles) {
    if (!origRoles.has(role)) return true;
  }
  return false;
}

function DisplayTab(): JSX.Element {
  const t = useTranslations('projectDetail.settings');

  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <Settings className="h-8 w-8 text-foreground-tertiary" />
      <p className="text-body2 text-foreground-tertiary">
        {t('display.placeholder')}
      </p>
    </div>
  );
}

export function ProjectSettingsDialog({
  open,
  onOpenChange,
  projectId,
}: Props): JSX.Element {
  const t = useTranslations('projectDetail.settings');
  const settingsQuery = useProjectDeadlineSettings(projectId);
  const upsertSetting = useUpsertProjectDeadlineSetting(projectId);
  const deleteSetting = useDeleteProjectDeadlineSetting(projectId);

  const serverSettings = settingsQuery.data ?? [];

  const [localSettings, setLocalSettings] = useState<EffectiveDeadlineNotificationSettings[]>([]);
  const [pendingResets, setPendingResets] = useState<Set<string>>(new Set());
  const [initialized, setInitialized] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      setInitialized(false);
      return;
    }
    if (initialized || serverSettings.length === 0) return;
    setLocalSettings(serverSettings.map((s) => ({ ...s })));
    setPendingResets(new Set());
    setInitialized(true);
  }, [open, serverSettings, initialized]);

  const handleUpdate = useCallback((
    deadlineType: string,
    body: DeadlineNotificationSettingsUpdate,
  ): void => {
    setLocalSettings((prev) => prev.map((s) => {
      if (s.deadline_type !== deadlineType) return s;
      return {
        ...s,
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.reminder_days !== undefined ? { reminder_days: body.reminder_days } : {}),
        ...(body.recipient_roles !== undefined ? { recipient_roles: body.recipient_roles } : {}),
      };
    }));
    setPendingResets((prev) => {
      if (!prev.has(deadlineType)) return prev;
      const next = new Set(prev);
      next.delete(deadlineType);
      return next;
    });
  }, []);

  const handleRevert = useCallback((deadlineType: string): void => {
    setPendingResets((prev) => new Set(prev).add(deadlineType));
    const original = serverSettings.find((s) => s.deadline_type === deadlineType);
    if (original !== undefined) {
      setLocalSettings((prev) => prev.map((s) =>
        s.deadline_type === deadlineType ? { ...original } : s,
      ));
    }
  }, [serverSettings]);

  const handleResetAll = useCallback((): void => {
    const overrideTypes = serverSettings
      .filter((s) => s.source === 'project_override')
      .map((s) => s.deadline_type);
    setPendingResets(new Set(overrideTypes));
    setLocalSettings(serverSettings.map((s) => ({ ...s })));
  }, [serverSettings]);

  const isDirty = useMemo(() => {
    if (pendingResets.size > 0) return true;
    for (const local of localSettings) {
      const original = serverSettings.find((s) => s.deadline_type === local.deadline_type);
      if (original !== undefined && hasSettingChanged(original, local)) return true;
    }
    return false;
  }, [localSettings, serverSettings, pendingResets]);

  const hasProjectOverrides = serverSettings.some((s) => s.source === 'project_override');

  const handleSave = useCallback(async (): Promise<void> => {
    setIsSaving(true);
    try {
      const promises: Promise<unknown>[] = [];

      for (const dt of pendingResets) {
        const original = serverSettings.find((s) => s.deadline_type === dt);
        if (original?.source === 'project_override') {
          promises.push(deleteSetting.mutateAsync({ deadlineType: dt }));
        }
      }

      for (const local of localSettings) {
        if (pendingResets.has(local.deadline_type)) continue;
        const original = serverSettings.find((s) => s.deadline_type === local.deadline_type);
        if (original !== undefined && hasSettingChanged(original, local)) {
          promises.push(upsertSetting.mutateAsync({
            deadlineType: local.deadline_type,
            body: {
              enabled: local.enabled,
              reminder_days: local.reminder_days,
              recipient_roles: local.recipient_roles,
            },
          }));
        }
      }

      await Promise.all(promises);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  }, [pendingResets, localSettings, serverSettings, deleteSetting, upsertSetting, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100vh-48px)] max-w-none flex-col"
        style={{ width: 720, height: 560, maxWidth: 'calc(100vw - 48px)' }}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 flex-1 overflow-y-auto">
          <Tabs defaultValue="notifications">
            <TabsList className="mb-4 inline-flex w-auto">
              <TabsTrigger value="notifications">
                {t('tabs.notifications')}
              </TabsTrigger>
              <TabsTrigger value="display">
                {t('tabs.display')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="notifications">
              {settingsQuery.isLoading || !initialized ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <DeadlineNotificationForm
                  settings={localSettings}
                  onUpdate={handleUpdate}
                  onRevert={handleRevert}
                  isUpdating={isSaving}
                  showRevert
                />
              )}
            </TabsContent>
            <TabsContent value="display">
              <DisplayTab />
            </TabsContent>
          </Tabs>
        </DialogBody>

        <DialogFooter className="justify-between">
          <Button
            type="button"
            variant="border"
            size="md"
            disabled={(!hasProjectOverrides && !isDirty) || isSaving}
            onClick={handleResetAll}
          >
            {('resetDefaults')}
          </Button>
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button type="button" variant="border" size="md" disabled={isSaving}>
                {t('cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="primary"
              size="md"
              disabled={!isDirty || isSaving}
              onClick={() => { void handleSave(); }}
            >
              {t('save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
