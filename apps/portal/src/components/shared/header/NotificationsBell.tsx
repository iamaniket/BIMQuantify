'use client';

import { IconButton } from '@bimstitch/ui';
import { AlertTriangle, Bell, Check, CheckCircle2, Clock, Loader2, Mail, RefreshCw, Search, Trash2, UserPlus, X, XCircle } from '@bimstitch/ui/icons';
import {
  useEffect, useRef, useState, type JSX,
} from 'react';
import { useTranslations } from 'next-intl';

import {
  useCancelJob,
  useJob,
  useRetryJob,
} from '@/features/jobs/hooks';
import {
  useClearAll,
  useDismiss,
  useMarkAllRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/useNotifications';
import type {
  Notification,
  NotificationEventTypeValue,
} from '@/lib/api/schemas/notifications';

/** Notification event types whose job may still be acted on (retry/cancel) or
 * is still progressing — only these resolve their live `Job` for controls. */
const ACTIONABLE_EVENT_TYPES: ReadonlySet<NotificationEventTypeValue> = new Set([
  'job_started',
  'job_progress',
  'job_failed',
]);

const ICON_BY_TYPE: Record<NotificationEventTypeValue, JSX.Element> = {
  job_started: <Loader2 className="h-3 w-3" aria-hidden />,
  job_progress: <RefreshCw className="h-3 w-3" aria-hidden />,
  job_succeeded: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  job_failed: <AlertTriangle className="h-3 w-3" aria-hidden />,
  deadline_upcoming: <Clock className="h-3 w-3" aria-hidden />,
  deadline_missed: <AlertTriangle className="h-3 w-3" aria-hidden />,
  finding_created: <Search className="h-3 w-3" aria-hidden />,
  finding_resolved: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  invitation_sent: <Mail className="h-3 w-3" aria-hidden />,
  invitation_accepted: <UserPlus className="h-3 w-3" aria-hidden />,
};

const TONE_BY_TYPE: Record<NotificationEventTypeValue, string> = {
  job_started: 'bg-info-lighter text-info-hover',
  job_progress: 'bg-info-lighter text-info-hover',
  job_succeeded: 'bg-success-lighter text-success',
  job_failed: 'bg-error-lighter text-error',
  deadline_upcoming: 'bg-warning-lighter text-warning',
  deadline_missed: 'bg-error-lighter text-error',
  finding_created: 'bg-warning-lighter text-warning',
  finding_resolved: 'bg-success-lighter text-success',
  invitation_sent: 'bg-info-lighter text-info-hover',
  invitation_accepted: 'bg-success-lighter text-success',
};

function formatRelative(iso: string, t: ReturnType<typeof useTranslations>): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('justNow');
  if (m < 60) return t('minutesAgo', { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('hoursAgo', { count: h });
  const d = Math.floor(h / 24);
  return t('daysAgo', { count: d });
}

/** Live job controls behind a notification: a progress bar while in-flight,
 * a Retry button on a retriable failure, a Cancel button while still queued.
 * Resolves the job lazily — only actionable notifications fetch it. */
function JobControls({
  notification,
}: {
  notification: Notification;
}): JSX.Element | null {
  const t = useTranslations('notifications');
  const actionable = notification.job_id !== null
    && ACTIONABLE_EVENT_TYPES.has(notification.event_type);
  const jobQuery = useJob(notification.job_id, actionable);
  const projectId = notification.project_id ?? '';
  const retry = useRetryJob(projectId);
  const cancel = useCancelJob(projectId);

  const job = jobQuery.data;
  if (!actionable || job === undefined || notification.job_id === null) {
    return null;
  }
  const jobId = notification.job_id;

  const showProgress = (job.status === 'running' || job.status === 'started') && job.progress > 0;
  const canRetry = job.status === 'failed' && job.retriable;
  const canCancel = job.status === 'pending' || job.status === 'started';

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {showProgress ? (
        <div className="flex items-center gap-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-background-hover">
            <div
              className="h-full rounded-full bg-info transition-[width] duration-300"
              style={{ width: `${String(Math.min(100, job.progress))}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] tabular-nums text-foreground-tertiary">
            {t('progressLabel', { percent: job.progress })}
          </span>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        {canRetry ? (
          <button
            type="button"
            disabled={retry.isPending}
            onClick={() => {
              retry.mutate(jobId);
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-primary hover:bg-background-hover disabled:cursor-default disabled:opacity-40"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            {retry.isPending ? t('retrying') : t('retry')}
          </button>
        ) : null}
        {job.status === 'failed' && !job.retriable ? (
          <span className="text-[10px] text-foreground-tertiary">
            {t('notRetriable')}
          </span>
        ) : null}
        {canCancel ? (
          <button
            type="button"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate(jobId);
            }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-foreground-secondary hover:bg-background-hover disabled:cursor-default disabled:opacity-40"
          >
            <X className="h-3 w-3" aria-hidden />
            {cancel.isPending ? t('cancelling') : t('cancel')}
          </button>
        ) : null}
        {job.status === 'cancelled' ? (
          <span className="text-[10px] text-foreground-tertiary">
            {t('cancelled')}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function NotificationRow({
  notification,
  onDismiss,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('notifications');
  const n = notification;
  return (
    <li
      className={`flex cursor-pointer gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0 ${n.is_read ? '' : 'bg-primary-lighter'}`}
    >
      <div className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-md ${TONE_BY_TYPE[n.event_type]}`}>
        {ICON_BY_TYPE[n.event_type]}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5 text-xs font-medium text-foreground">
          <span className="truncate font-semibold">{n.title}</span>
        </div>
        {n.body.length > 0 ? (
          <div className="mt-0.5 truncate text-[11px] text-foreground-tertiary">
            {n.body}
          </div>
        ) : null}
        <div className="mt-1 font-sans text-[10px] tracking-[0.02em] text-foreground-tertiary">
          {formatRelative(n.created_at, t)}
        </div>
        <JobControls notification={n} />
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <IconButton
          size="sm"
          aria-label={t('dismiss')}
          title={t('dismiss')}
          className="hover:bg-error-lighter hover:text-error"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(n.id);
          }}
        >
          <XCircle className="h-[18px] w-[18px]" aria-hidden />
        </IconButton>
        {n.is_read ? null : (
          <span className="h-[7px] w-[7px] rounded-full bg-primary" />
        )}
      </div>
    </li>
  );
}

function NotificationListBody({
  isLoading,
  items,
  onDismiss,
}: {
  isLoading: boolean;
  items: Notification[];
  onDismiss: (id: string) => void;
}): JSX.Element {
  const t = useTranslations('notifications');
  if (isLoading) {
    return (
      <div className="px-7 py-7 text-center text-xs text-foreground-tertiary">
        {t('loading')}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-7 py-7 text-center text-xs text-foreground-tertiary">
        {t('allCaughtUp')}
      </div>
    );
  }
  return (
    <ul>
      {items.map((n) => (
        <NotificationRow key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </ul>
  );
}

export function NotificationsBell(): JSX.Element {
  const t = useTranslations('notifications');
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const unreadQuery = useUnreadCount();
  const listQuery = useNotifications();
  const markAll = useMarkAllRead();
  const clearAll = useClearAll();
  const dismiss = useDismiss();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  const unreadCount = unreadQuery.data === undefined ? 0 : unreadQuery.data.count;
  const items: Notification[] = listQuery.data === undefined ? [] : listQuery.data.items;
  const total = listQuery.data === undefined ? 0 : listQuery.data.total;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
        }}
        title={t('title')}
        aria-label={t('title')}
        className="relative grid h-[40px] w-[40px] place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
      >
        <Bell className="h-5 w-5" aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute -right-[3px] -top-[3px] grid h-[14px] min-w-[14px] place-items-center rounded-full border-[1.5px] border-[var(--brand-gradient-start)] bg-[var(--header-notify-dot)] px-[3px] text-micro font-extrabold leading-[14px] tabular-nums text-white">
            {unreadCount > 9 ? '9+' : String(unreadCount)}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[460px] w-[360px] overflow-auto rounded-[10px] border border-border bg-background-secondary text-foreground shadow-[0_12px_32px_rgba(15,23,42,0.18),0_2px_6px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between border-b border-border px-3.5 py-3">
            <div>
              <div className="font-sans text-sm font-semibold tracking-[-0.01em] text-foreground">
                {t('title')}
              </div>
              <div className="mt-0.5 text-[10.5px] text-foreground-tertiary">
                {t('summary', { unread: unreadCount, total })}
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={unreadCount === 0 || markAll.isPending}
                onClick={() => {
                  markAll.mutate();
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-primary hover:bg-background-hover disabled:cursor-default disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" aria-hidden />
                {t('markAllRead')}
              </button>
              <button
                type="button"
                disabled={total === 0 || clearAll.isPending}
                onClick={() => {
                  clearAll.mutate();
                }}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-foreground-secondary hover:bg-error-lighter hover:text-error disabled:cursor-default disabled:opacity-40"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('clearAll')}
              </button>
            </div>
          </div>
          <NotificationListBody
            isLoading={listQuery.isLoading}
            items={items}
            onDismiss={(id) => {
              dismiss.mutate(id);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
