'use client';

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  useEffect, useRef, useState, type JSX,
} from 'react';

import {
  useMarkAllRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/useNotifications';
import type {
  Notification,
  NotificationEventTypeValue,
} from '@/lib/api/schemas/notifications';

const ICON_BY_TYPE: Record<NotificationEventTypeValue, JSX.Element> = {
  job_started: <Loader2 className="h-3 w-3" aria-hidden />,
  job_progress: <RefreshCw className="h-3 w-3" aria-hidden />,
  job_succeeded: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  job_failed: <AlertTriangle className="h-3 w-3" aria-hidden />,
  deadline_upcoming: <Clock className="h-3 w-3" aria-hidden />,
  deadline_missed: <AlertTriangle className="h-3 w-3" aria-hidden />,
};

const TONE_BY_TYPE: Record<NotificationEventTypeValue, string> = {
  job_started: 'bg-info-lighter text-info-hover',
  job_progress: 'bg-info-lighter text-info-hover',
  job_succeeded: 'bg-success-lighter text-success',
  job_failed: 'bg-error-lighter text-error',
  deadline_upcoming: 'bg-warning-lighter text-warning',
  deadline_missed: 'bg-error-lighter text-error',
};

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${String(m)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  const d = Math.floor(h / 24);
  return `${String(d)}d ago`;
}

function NotificationListBody({
  isLoading,
  items,
}: {
  isLoading: boolean;
  items: Notification[];
}): JSX.Element {
  if (isLoading) {
    return (
      <div className="px-7 py-7 text-center text-xs text-foreground-tertiary">
        Loading…
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="px-7 py-7 text-center text-xs text-foreground-tertiary">
        You&apos;re all caught up.
      </div>
    );
  }
  return (
    <ul>
      {items.map((n) => (
        <li
          key={n.id}
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
              {formatRelative(n.created_at)}
            </div>
          </div>
          {n.is_read ? null : (
            <span className="mt-1.5 h-[7px] w-[7px] shrink-0 self-center rounded-full bg-primary" />
          )}
        </li>
      ))}
    </ul>
  );
}

export function NotificationsBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const unreadQuery = useUnreadCount();
  const listQuery = useNotifications();
  const markAll = useMarkAllRead();

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
        title="Notifications"
        aria-label="Notifications"
        className="relative grid h-[30px] w-[30px] place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
      >
        <Bell className="h-[14px] w-[14px]" aria-hidden />
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
                Notifications
              </div>
              <div className="mt-0.5 text-[10.5px] text-foreground-tertiary">
                {String(unreadCount)} unread · {String(total)} total
              </div>
            </div>
            <button
              type="button"
              disabled={unreadCount === 0 || markAll.isPending}
              onClick={() => {
                markAll.mutate();
              }}
              className="rounded p-1 text-[11px] font-semibold text-primary hover:bg-background-hover disabled:cursor-default disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
          <NotificationListBody isLoading={listQuery.isLoading} items={items} />
        </div>
      ) : null}
    </div>
  );
}
