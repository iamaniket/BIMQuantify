'use client';

import { Spinner } from '@bimstitch/ui';
import type { JSX, ReactNode } from 'react';

import { Link } from '@/i18n/navigation';

/**
 * Bordered "pill" action shared across every collapsible resource-row tab
 * (Models, Reports, Certificates, Attachments, Findings) — collapsed-row hover
 * actions and the expanded action bar. Default tone tints toward the brand
 * primary on hover; `danger` tints toward error.
 *
 * Three render modes, resolved in order:
 *  (a) `href`     -> next-intl `<Link>` for an **internal** route (e.g. View → viewer).
 *  (b) `external` -> plain `<a href download>` for an **external/presigned** URL
 *                    (e.g. a report's download URL). Bypasses next-intl Link.
 *  (c) otherwise  -> `<button>`.
 *
 * `href` and `external` are mutually exclusive. Every mode `stopPropagation`s its
 * click so it never toggles the surrounding expandable row.
 *
 * Imported via its direct path (not the barrel) so the next-intl `Link` import
 * stays out of the shared/resource barrel's module graph.
 */
type Props = {
  icon: ReactNode;
  label: string;
  tone?: 'default' | 'danger';
  size?: 'sm' | 'md';
  /** Internal route -> next-intl `<Link>`. Mutually exclusive with `external`. */
  href?: string;
  /** External/presigned URL -> plain `<a>`. Mutually exclusive with `href`. */
  external?: string;
  /** `download` attribute for the `external` `<a>`. */
  download?: string;
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
    ? 'border-border bg-surface-main text-error hover:border-error hover:bg-error-light hover:text-error '
      + 'disabled:hover:border-border disabled:hover:bg-surface-main disabled:hover:text-error'
    : 'border-border bg-surface-main text-foreground-secondary hover:border-primary hover:bg-primary-lighter hover:text-primary '
      + 'disabled:hover:border-border disabled:hover:bg-surface-main disabled:hover:text-foreground-secondary';
  return `${baseCls} ${sizeCls} ${toneCls}`;
}

export function RowActionPill({
  icon,
  label,
  tone = 'default',
  size = 'md',
  href,
  external,
  download,
  onClick,
  onMouseEnter,
  onFocus,
  disabled = false,
  pending = false,
  title,
}: Props): JSX.Element {
  const spinnerCls = size === 'sm' ? 'h-3 w-3 text-current' : 'h-3.5 w-3.5 text-current';
  const content = (
    <>
      {pending ? <Spinner size="md" className={spinnerCls} /> : icon}
      {label}
    </>
  );

  // (a) internal route
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

  // (b) external / presigned URL
  if (external !== undefined && !disabled) {
    return (
      <a
        href={external}
        download={download}
        title={title}
        onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        onMouseEnter={onMouseEnter}
        onFocus={onFocus}
        className={classes(tone, size)}
      >
        {content}
      </a>
    );
  }

  // (c) button
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
