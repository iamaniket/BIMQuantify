import { CaretRight } from '@phosphor-icons/react';
import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from './lib/cn.js';
import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';

export type MediaRowProps = Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'onClick'> & {
  /** Leading media slot (e.g. an `IconTile`). */
  media?: ReactNode;
  /** Primary line (truncates). */
  title: ReactNode;
  /** Optional content line between the title and subtitle (truncates). Slightly
   * more prominent than `subtitle` since it carries content, not metadata. */
  description?: ReactNode;
  /** Muted secondary line under the title (truncates). */
  subtitle?: ReactNode;
  /** Always-visible right slot (e.g. a status/severity badge). */
  trailing?: ReactNode;
  /** Render a chevron that fades in on hover, hinting the row opens something. */
  showChevron?: boolean;
  /** Dim and disable interaction. */
  disabled?: boolean;
  onClick?: () => void;
};

/**
 * A generic, clickable list row: leading media + a two-line text block +
 * optional trailing slot + an optional hover-revealed chevron. Unlike
 * `DetailCardRow` it carries no accordion/expand semantics — it's a plain
 * activate-on-click row (opens a dialog, navigates, …). Rendered as a
 * `role="button"` div (not a `<button>`) so trailing interactive children stay
 * valid HTML. Height is consumer-controlled via `className` for callers that
 * need a deterministic row height (e.g. height-based row fitting).
 */
export const MediaRow = forwardRef<HTMLDivElement, MediaRowProps>(
  ({
    media, title, description, subtitle, trailing, showChevron, disabled, onClick, className, ...rest
  }, ref) => {
    const interactive = onClick !== undefined && disabled !== true;
    return (
      <div
        ref={ref}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        aria-disabled={disabled === true ? true : undefined}
        onClick={interactive ? onClick : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onClick?.();
                }
              }
            : undefined
        }
        className={cn(
          'group flex min-h-[2.5rem] w-full items-center gap-3 rounded-lg px-2 text-left',
          interactive && 'cursor-pointer hover:bg-background-hover',
          disabled === true && 'opacity-60',
          className,
        )}
        {...rest}
      >
        {media !== undefined && media}

        <div className="min-w-0 flex-1">
          <div className="truncate text-body3 font-medium text-foreground">{title}</div>
          {description !== undefined && (
            <div className="mt-0.5 truncate text-caption text-foreground-secondary">{description}</div>
          )}
          {subtitle !== undefined && (
            <div className="mt-0.5 truncate text-caption text-foreground-tertiary">{subtitle}</div>
          )}
        </div>

        {trailing !== undefined && <div className="shrink-0">{trailing}</div>}

        {showChevron === true && (
          <CaretRight
            weight={DEFAULT_ICON_WEIGHT}
            aria-hidden
            className="h-4 w-4 shrink-0 text-foreground-tertiary opacity-0 transition-opacity group-hover:opacity-100"
          />
        )}
      </div>
    );
  },
);

MediaRow.displayName = 'MediaRow';
