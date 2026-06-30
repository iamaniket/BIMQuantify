'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState, type JSX, type ReactNode } from 'react';
import { toast } from 'sonner';

import {
  Badge,
  Button,
  CountChip,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Progress,
  Skeleton,
  Switch,
} from '@bimdossier/ui';

import type { Locale } from '@bimdossier/i18n';

import { getFreeUserDetail } from '@/lib/api/admin';
import { getErrorMessage } from '@/lib/api/errorMessages';
import type { FreeUserLimits, FreeUserRead } from '@/lib/api/schemas';
import { formatDate } from '@/lib/formatting/dates';
import { formatFileSize } from '@/lib/formatting/files';
import { useAuthQuery } from '@/lib/query/useAuthQuery';

import { adminFreeUserDetailKey } from './queryKeys';
import { isStaleAccount } from './staleness';
import {
  useDeleteFreeUser,
  useResendActivation,
  useSendPasswordReset,
  useToggleActivateFreeUser,
  useUpdateFreeUserLimits,
} from './useFreeUserActions';

const BYTES_PER_GB = 1024 ** 3;

type Props = {
  user: FreeUserRead | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-caption font-semibold uppercase tracking-wide text-foreground-tertiary">{title}</h4>
      <div className="divide-y divide-border rounded-lg border border-border">{children}</div>
    </div>
  );
}

function Row({
  primary,
  secondary,
  children,
}: {
  primary: string;
  secondary: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-body3 font-medium">{primary}</div>
        <div className="truncate text-caption text-foreground-tertiary">{secondary}</div>
      </div>
      {children !== undefined && <div className="shrink-0">{children}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <p className="px-3 py-2 text-caption text-foreground-tertiary">{text}</p>;
}

function StatItem({
  label,
  value,
  warn = false,
}: {
  label: string;
  value: string;
  warn?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col">
      <span className="text-caption uppercase tracking-wide text-foreground-tertiary">{label}</span>
      <span
        className={
          warn
            ? 'text-body3 font-medium tabular-nums text-warning'
            : 'text-body3 font-medium tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  );
}

function LimitField({
  label,
  hint,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <Label className="text-caption text-foreground-tertiary">{label}</Label>
      <Input
        type="number"
        min={1}
        inputMode="numeric"
        value={value}
        placeholder={hint}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function _nullableInt(raw: string): number | null {
  const v = raw.trim();
  if (v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Super-admin editor for one free account's per-user limit overrides + trial.
 * Empty input = "use the global default" (clears the override). Storage is edited
 * in GB and stored as bytes. The trial badge reflects the live (server) state.
 */
function LimitsSection({
  userId,
  limits,
}: {
  userId: string;
  limits: FreeUserLimits;
}): JSX.Element {
  const t = useTranslations('admin.freeUsers.detail');
  const locale = useLocale() as Locale;
  const update = useUpdateFreeUserLimits();

  const [projects, setProjects] = useState(limits.override_max_projects?.toString() ?? '');
  const [members, setMembers] = useState(
    limits.override_max_members_per_project?.toString() ?? '',
  );
  const [containers, setContainers] = useState(
    limits.override_max_documents?.toString() ?? '',
  );
  const [storageGb, setStorageGb] = useState(
    limits.override_storage_max_bytes !== null
      ? String(limits.override_storage_max_bytes / BYTES_PER_GB)
      : '',
  );
  const [trialDays, setTrialDays] = useState(
    limits.override_account_max_age_days?.toString() ?? '',
  );
  const [exempt, setExempt] = useState(limits.expiry_exempt);

  const handleSave = useCallback(() => {
    const gb = storageGb.trim();
    const storageBytes = gb === '' ? null : Math.round(Number.parseFloat(gb) * BYTES_PER_GB);
    update.mutate(
      {
        userId,
        limits: {
          max_projects: _nullableInt(projects),
          max_members_per_project: _nullableInt(members),
          max_documents: _nullableInt(containers),
          storage_max_bytes:
            storageBytes !== null && Number.isFinite(storageBytes) ? storageBytes : null,
          account_max_age_days: _nullableInt(trialDays),
          expiry_exempt: exempt,
        },
      },
      {
        onSuccess: () => toast.success(t('limitsSaved')),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  }, [update, userId, projects, members, containers, storageGb, trialDays, exempt, t]);

  const gbDefault = limits.default_storage_max_bytes / BYTES_PER_GB;

  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-caption font-semibold uppercase tracking-wide text-foreground-tertiary">
          {t('limitsTitle')}
        </h4>
        {limits.expiry_exempt ? (
          <Badge variant="info">{t('trialExempt')}</Badge>
        ) : limits.expired ? (
          <Badge variant="error">{t('trialExpired')}</Badge>
        ) : (
          <span className="text-caption tabular-nums text-foreground-tertiary">
            {limits.account_expires_at != null
              && t('trialEnds', { date: formatDate(limits.account_expires_at, locale) })}
            {limits.days_remaining != null
              && ` · ${t('trialDaysLeft', { days: limits.days_remaining })}`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <LimitField
          label={t('projectsLabel')}
          hint={t('defaultHint', { value: limits.default_max_projects })}
          value={projects}
          onChange={setProjects}
        />
        <LimitField
          label={t('membersLabel')}
          hint={t('defaultHint', { value: limits.default_max_members_per_project })}
          value={members}
          onChange={setMembers}
        />
        <LimitField
          label={t('containersLabel')}
          hint={t('defaultHint', { value: limits.default_max_documents })}
          value={containers}
          onChange={setContainers}
        />
        <LimitField
          label={t('storageLabel')}
          hint={t('defaultHint', { value: gbDefault })}
          value={storageGb}
          onChange={setStorageGb}
        />
        <LimitField
          label={t('trialDaysLabel')}
          hint={t('defaultHint', { value: limits.default_account_max_age_days })}
          value={trialDays}
          onChange={setTrialDays}
          disabled={exempt}
        />
      </div>

      <label className="flex items-center gap-2 text-body3 text-foreground-secondary">
        <Switch checked={exempt} onChange={(e) => setExempt(e.target.checked)} />
        {t('exemptLabel')}
      </label>

      <div className="flex justify-end">
        <Button variant="primary" size="md" disabled={update.isPending} onClick={handleSave}>
          {t('saveLimits')}
        </Button>
      </div>
    </div>
  );
}

export function FreeUserDetailPanel({ user, open, onOpenChange }: Props): JSX.Element {
  const t = useTranslations('admin.freeUsers.detail');
  const tTable = useTranslations('admin.freeUsers.table');
  const locale = useLocale() as Locale;

  const detail = useAuthQuery({
    queryKey: adminFreeUserDetailKey(user?.id ?? 'none'),
    queryFn: (token) => getFreeUserDetail(token, user?.id ?? ''),
    enabled: open && user !== null,
  });

  // `user` is the list-row snapshot captured when the panel opened; it never
  // changes while the panel stays open. The suspend/reactivate/delete mutations
  // invalidate this user's detail query, so prefer the freshly-fetched
  // `detail.data.user` once it's loaded — that's what flips the status badge and
  // switches the toggle between Suspend and Reactivate in place, without having
  // to close and reopen the panel.
  const live = detail.data?.user ?? user;

  const toggleActive = useToggleActivateFreeUser();
  const del = useDeleteFreeUser();
  const reset = useSendPasswordReset();
  const resend = useResendActivation();
  const pending = toggleActive.isPending || del.isPending || reset.isPending || resend.isPending;

  const handleToggle = useCallback(() => {
    if (live === null) return;
    const active = !live.is_active;
    toggleActive.mutate(
      { userId: live.id, active },
      { onSuccess: () => { toast.success(active ? t('reactivated') : t('suspended')); } },
    );
  }, [live, toggleActive, t]);

  const handleReset = useCallback(() => {
    if (live === null) return;
    reset.mutate({ userId: live.id }, { onSuccess: () => { toast.success(t('resetSent')); } });
  }, [live, reset, t]);

  const handleResend = useCallback(() => {
    if (live === null) return;
    resend.mutate({ userId: live.id }, { onSuccess: () => { toast.success(t('activationResent')); } });
  }, [live, resend, t]);

  const handleDelete = useCallback(() => {
    if (live === null || typeof window === 'undefined') return;
    const ok = window.confirm(t('deleteConfirm', { email: live.email }));
    if (!ok) return;
    del.mutate(
      { userId: live.id },
      { onSuccess: () => { toast.success(t('deleted')); onOpenChange(false); } },
    );
  }, [live, del, t, onOpenChange]);

  const used = live?.usage.storage_bytes_used ?? 0;
  const cap = live?.usage.storage_bytes_cap ?? 0;
  const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
  const totalFiles = detail.data?.documents.reduce((sum, d) => sum + d.file_count, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{live?.full_name ?? live?.email ?? ''}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {live !== null && (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-body3 text-foreground-secondary">{live.email}</span>
                <Badge variant={live.is_active ? 'success' : 'error'}>
                  {live.is_active ? tTable('statusActive') : tTable('statusSuspended')}
                </Badge>
                {!live.is_verified && <Badge variant="warning">{tTable('statusUnverified')}</Badge>}
              </div>

              <div className="flex flex-col gap-1">
                <Progress value={pct} variant={pct >= 100 ? 'error' : pct >= 70 ? 'warning' : 'success'} />
                <div className="flex items-center justify-between text-caption tabular-nums text-foreground-tertiary">
                  <span>{t('storage', { used: formatFileSize(used), cap: formatFileSize(cap) })}</span>
                  <span>{t('storagePct', { pct })}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
                <StatItem label={t('accountCreated')} value={formatDate(live.created_at, locale)} />
                <StatItem
                  label={t('lastActive')}
                  value={
                    live.usage.last_activity_at != null
                      ? formatDate(live.usage.last_activity_at, locale)
                      : t('never')
                  }
                  warn={isStaleAccount(live.created_at, live.usage.last_activity_at)}
                />
                {live.usage.first_activity_at != null && (
                  <StatItem
                    label={t('firstContent')}
                    value={formatDate(live.usage.first_activity_at, locale)}
                  />
                )}
              </div>

              <div className="flex flex-wrap gap-4 text-caption text-foreground-tertiary">
                <span>{t('projectsStat', { count: live.usage.project_count, cap: live.usage.project_cap })}</span>
                <span>{t('containersStat', { count: live.usage.document_count, cap: live.usage.document_cap })}</span>
                <span>{t('snagsStat', { count: live.usage.snag_count })}</span>
                <span>{t('sharedStat', { count: live.usage.member_of_count })}</span>
                {detail.data !== undefined && <span>{t('filesStat', { count: totalFiles })}</span>}
              </div>

              <LimitsSection userId={live.id} limits={live.limits} />
            </>
          )}

          {detail.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : detail.isError || detail.data === undefined ? (
            <p className="text-body3 text-error">{t('loadError')}</p>
          ) : (
            <>
              <Section title={t('projectsTitle', { count: detail.data.projects.length })}>
                {detail.data.projects.length === 0 ? (
                  <Empty text={t('noProjects')} />
                ) : (
                  detail.data.projects.map((p) => (
                    <Row key={p.id} primary={p.name} secondary={formatDate(p.created_at, locale)}>
                      <CountChip>
                        {t('projectMeta', {
                          containers: p.document_count,
                          snags: p.snag_count,
                          size: formatFileSize(p.storage_bytes),
                        })}
                      </CountChip>
                    </Row>
                  ))
                )}
              </Section>

              <Section title={t('containersTitle', { count: detail.data.documents.length })}>
                {detail.data.documents.length === 0 ? (
                  <Empty text={t('noContainers')} />
                ) : (
                  detail.data.documents.map((d) => (
                    <Row
                      key={d.id}
                      primary={d.name}
                      secondary={t('containerMeta', { files: d.file_count, size: formatFileSize(d.size_bytes) })}
                    >
                      <Badge variant="default">{d.status}</Badge>
                    </Row>
                  ))
                )}
              </Section>

              <Section title={t('snagsTitle', { count: detail.data.snags.length })}>
                {detail.data.snags.length === 0 ? (
                  <Empty text={t('noSnags')} />
                ) : (
                  detail.data.snags.map((s) => (
                    <Row key={s.id} primary={s.title} secondary={formatDate(s.created_at, locale)}>
                      <Badge variant="default">{s.status}</Badge>
                    </Row>
                  ))
                )}
              </Section>

              {detail.data.shared_projects.length > 0 && (
                <Section title={t('sharedTitle', { count: detail.data.shared_projects.length })}>
                  {detail.data.shared_projects.map((s) => (
                    <Row key={s.free_project_id} primary={s.name} secondary={s.owner_email}>
                      <Badge variant="info">{s.role}</Badge>
                    </Row>
                  ))}
                </Section>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter className="flex-wrap justify-end gap-2">
          {live !== null && (
            <>
              <Button variant="border" size="md" disabled={pending} onClick={handleReset}>
                {t('sendReset')}
              </Button>
              {!live.is_verified && (
                <Button variant="border" size="md" disabled={pending} onClick={handleResend}>
                  {t('resendActivation')}
                </Button>
              )}
              <Button
                variant={live.is_active ? 'border' : 'primary'}
                size="md"
                disabled={pending}
                onClick={handleToggle}
              >
                {live.is_active ? t('suspend') : t('reactivate')}
              </Button>
              <Button variant="destructive" size="md" disabled={pending} onClick={handleDelete}>
                {t('delete')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
