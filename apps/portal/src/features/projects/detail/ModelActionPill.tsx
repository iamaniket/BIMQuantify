'use client';

import { Spinner } from '@bimstitch/ui';
import type { JSX, ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

/**
 * Small bordered pill action used across the Models tab — collapsed-row hover
 * actions, the expanded action bar, and the bulk-selection bar. Default tone
 * tints toward the brand primary on hover; `danger` tints toward error. Renders
 * a `<Link>` when `href` is set (View), otherwise a `<button>`. Clicks
 * `stopPropagation` so they never toggle the surrounding expandable row.
 */
type Props = {
  icon: ReactNode;
  label: string;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
  /** Renders a router link instead of a button (used for "View"). */
  href?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  onFocus?: () => void;
  disabled?: boolean;
  pending?: boolean;
  title?: string;
};

const baseCls =
  'inline-flex shrink-0 items-center gap-1.5 rounded-md border font-sans font-semibold transition-all '
  + 'disabled:cursor-not-allowed disabled:opacity-50';

function classes(tone: 'default' | 'danger', size: 'sm' | 'md'): string {
  const sizeCls = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-body3';
  const toneCls = tone === 'danger'
    ? 'border-border bg-surface-main text-error hover:border-error hover:bg-error-light hover:text-error'
    : 'border-border bg-surface-main text-foreground-secondary hover:border-primary hover:bg-primary-lighter hover:text-primary';
  return `${baseCls} ${sizeCls} ${toneCls}`;
}

export function ModelActionPill({
  icon,
  label,
  tone = 'default',
  size = 'md',
  href,
  onClick,
  onMouseEnter,
  onFocus,
  disabled = false,
  pending = false,
  title,
}: Props): JSX.Element {
  const content = (
    <>
      {pending ? <Spinner size="md" className="text-current" /> : icon}
      {label}
    </>
  );

  if (href !== undefined && !disabled) {
    return (
      <Link
        href={href}
        title={title}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        className={classes(tone, size)}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled || pending}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onMouseEnter={onMouseEnter}
      onFocus={onFocus}
      className={classes(tone, size)}
    >
      {content}
    </button>
  );
}
