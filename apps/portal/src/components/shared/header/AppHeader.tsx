'use client';

import { type JSX, type ReactNode } from 'react';

import { ThemeToggle } from '@bimstitch/ui';

import { Link } from '@/i18n/navigation';

import { LocaleToggle } from './LocaleToggle';

export type Crumb = {
  label: string;
  href: string | undefined;
};

export type StatusTone = 'success' | 'warning' | 'error' | 'info';

export type AppHeaderStatus = {
  label: string;
  tone: StatusTone | undefined;
};

export type AppHeaderAction = {
  label: string;
  onClick: () => void;
  icon: ReactNode | undefined;
};

type Props = {
  crumbs: Crumb[];
  lastCrumbSlot?: ReactNode;
  status: AppHeaderStatus | null;
  action: AppHeaderAction | null;
  rightSlot: ReactNode;
};

const STATUS_TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-[var(--header-status-success-bg)] text-[var(--header-status-success-fg)] border-[var(--header-status-success-border)]',
  warning: 'bg-[var(--header-status-warning-bg)] text-[var(--header-status-warning-fg)] border-[var(--header-status-warning-border)]',
  error: 'bg-[var(--header-status-error-bg)] text-[var(--header-status-error-fg)] border-[var(--header-status-error-border)]',
  info: 'bg-[var(--header-status-info-bg)] text-[var(--header-status-info-fg)] border-[var(--header-status-info-border)]',
};

const STATUS_DOT_CLASSES: Record<StatusTone, string> = {
  success: 'bg-[var(--header-status-success-dot)]',
  warning: 'bg-[var(--header-status-warning-dot)]',
  error: 'bg-[var(--header-status-error-dot)]',
  info: 'bg-[var(--header-status-info-dot)]',
};

function StatusPill({ status }: { status: AppHeaderStatus }): JSX.Element {
  const tone: StatusTone = status.tone ?? 'info';
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-micro font-bold uppercase tracking-[0.06em] ${STATUS_TONE_CLASSES[tone]}`}
    >
      <span className={`h-[5px] w-[5px] rounded-full ${STATUS_DOT_CLASSES[tone]}`} />
      {status.label}
    </span>
  );
}

function GridTexture(): JSX.Element {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.08]"
    >
      <defs>
        <pattern id="appheader-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="white" strokeWidth="0.6" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#appheader-grid)" />
    </svg>
  );
}

function CrumbItem({ crumb, isLast }: { crumb: Crumb; isLast: boolean }): JSX.Element {
  const text = (
    <span
      className={`whitespace-nowrap ${isLast ? 'font-semibold text-white' : 'text-white/70 hover:text-white'}`}
    >
      {crumb.label}
    </span>
  );
  if (!isLast && crumb.href !== undefined) {
    return <Link href={{ pathname: crumb.href }}>{text}</Link>;
  }
  return text;
}

function Breadcrumbs({ crumbs, lastCrumbSlot }: { crumbs: Crumb[]; lastCrumbSlot?: ReactNode }): JSX.Element | null {
  if (crumbs.length === 0) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-body3 font-medium">
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${String(i)}-${c.label}`} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-caption text-white/55">/</span> : null}
            {isLast && lastCrumbSlot !== undefined ? lastCrumbSlot : <CrumbItem crumb={c} isLast={isLast} />}
          </span>
        );
      })}
    </div>
  );
}

export function AppHeader({
  crumbs, lastCrumbSlot, status, action, rightSlot,
}: Props): JSX.Element {
  return (
    <header
      className="relative flex h-[52px] shrink-0 items-center gap-3.5 border-b border-white/10 bg-[var(--brand-gradient-start)] px-4 text-white"
    >
      <GridTexture />

      <div className="relative flex min-w-0 flex-1 items-center gap-2.5">
        <Breadcrumbs crumbs={crumbs} lastCrumbSlot={lastCrumbSlot} />
        {status === null ? null : <StatusPill status={status} />}
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {rightSlot}
        <LocaleToggle className="h-[40px] w-[40px] text-white/80 hover:bg-white/10 hover:text-white" />
        <ThemeToggle className="h-[40px] w-[40px] rounded-md text-white/80 hover:bg-white/10 hover:text-white" />
        {action === null ? null : (
          <button
            type="button"
            onClick={action.onClick}
            className="ml-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-white px-3.5 text-body3 font-bold text-[var(--brand-gradient-start)] shadow-[0_2px_6px_rgba(0,0,0,0.18)] hover:bg-white/90"
          >
            {action.icon === undefined ? (
              <span className="text-body2 font-extrabold">+</span>
            ) : (
              action.icon
            )}
            {action.label}
          </button>
        )}
      </div>
    </header>
  );
}
