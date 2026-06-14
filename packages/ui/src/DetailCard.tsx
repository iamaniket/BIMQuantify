'use client';

import { CaretDown } from '@phosphor-icons/react';

import { DEFAULT_ICON_WEIGHT } from './lib/icons.js';
import {
  createContext,
  forwardRef,
  useContext,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

import { cn } from './lib/cn.js';

/* ------------------------------------------------------------------ */
/*  Context                                                           */
/* ------------------------------------------------------------------ */

type DetailCardAccent = 'neutral' | 'primary';

type DetailCardCtx = {
  expanded: boolean;
  onToggle: () => void;
  accent: DetailCardAccent;
  selected: boolean;
};

const Ctx = createContext<DetailCardCtx>({
  expanded: false,
  onToggle: () => {},
  accent: 'neutral',
  selected: false,
});

/* ------------------------------------------------------------------ */
/*  DetailCard (root)                                                 */
/* ------------------------------------------------------------------ */

export type DetailCardProps = HTMLAttributes<HTMLDivElement> & {
  expanded: boolean;
  onToggle: () => void;
  /** `primary` tints the expanded/selected card with the brand accent (Models). */
  accent?: DetailCardAccent;
  /** Collapsed-but-checked state for multi-select rows. */
  selected?: boolean;
};

export const DetailCard = forwardRef<HTMLDivElement, DetailCardProps>(
  ({
    expanded, onToggle, accent = 'neutral', selected = false, className, children, ...rest
  }, ref) => {
    const expandedBg = accent === 'primary' ? 'bg-primary-lighter' : 'bg-surface-low';
    return (
      <Ctx.Provider value={{ expanded, onToggle, accent, selected }}>
        <div
          ref={ref}
          className={cn(
            'border-t border-border transition-colors',
            expanded ? expandedBg : (selected && accent === 'primary' && 'bg-primary-lighter'),
            className,
          )}
          {...rest}
        >
          {children}
        </div>
      </Ctx.Provider>
    );
  },
);

DetailCard.displayName = 'DetailCard';

/* ------------------------------------------------------------------ */
/*  DetailCardRow (primary clickable row)                             */
/* ------------------------------------------------------------------ */

export type DetailCardRowProps = HTMLAttributes<HTMLDivElement> & {
  media?: ReactNode | undefined;
  actions?: ReactNode | undefined;
  /** Right-aligned secondary info, shown only on `lg`+ widths. */
  aside?: ReactNode | undefined;
  /**
   * Always-visible right-side slot (e.g. a count chip). When provided, the
   * collapsed row swaps it for `actions` on hover instead of fading `actions`
   * in over reserved space. Consumers that omit it keep the legacy fade.
   */
  info?: ReactNode | undefined;
  hideChevron?: boolean | undefined;
};

export const DetailCardRow = forwardRef<HTMLDivElement, DetailCardRowProps>(
  ({
    media, actions, aside, info, hideChevron, className, children, ...rest
  }, ref) => {
    const { expanded, onToggle, accent, selected } = useContext(Ctx);
    const [hovered, setHovered] = useState(false);
    const borderW = accent === 'primary' ? 'border-l-[3px]' : 'border-l-2';
    const accentPad = accent === 'primary' ? 'pl-[9px]' : 'pl-[10px]';

    const gridTemplateColumns = [
      // `auto` (not a fixed 40px) so a media slot wider than 40px — e.g. the
      // Models row's checkbox + discipline badge — sizes to its content and
      // left-aligns instead of overflowing a 40px box jammed against the edge.
      media !== undefined ? 'auto' : null,
      '1fr',
      aside !== undefined ? 'auto' : null,
      'auto',
    ]
      .filter((c): c is string => c !== null)
      .join(' ');

    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onMouseEnter={() => { setHovered(true); }}
        onMouseLeave={() => { setHovered(false); }}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter') onToggle(); }}
        className={cn(
          'grid cursor-pointer items-center gap-3 px-3 py-2.5',
          expanded
            ? `${borderW} border-l-primary ${accentPad}`
            : selected
              ? `${borderW} border-l-primary-light ${accentPad}`
              : `${borderW} border-l-transparent`,
          !expanded && !selected && hovered && 'bg-background-hover',
          className,
        )}
        style={{ gridTemplateColumns }}
        {...rest}
      >
        {media !== undefined && (
          <div className="flex h-10 min-w-[40px] shrink-0 items-center justify-center">
            {media}
          </div>
        )}

        <div className="min-w-0 overflow-hidden">
          {children}
        </div>

        {aside !== undefined && (
          <div className="hidden items-center gap-3 justify-self-end font-sans text-[11px] text-foreground-tertiary tabular-nums lg:flex">
            {aside}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Top actions only when collapsed — once expanded, the footer owns them.
              With an `info` slot the row swaps info ↔ actions on hover; without
              one, actions fade in over reserved space (legacy behaviour). */}
          {!expanded && info !== undefined ? (
            <div className="flex items-center gap-1.5">
              {hovered && actions !== undefined ? actions : info}
            </div>
          ) : (
            actions !== undefined && !expanded && (
              <div className={cn(
                'flex items-center gap-1.5 transition-all',
                hovered ? 'opacity-100' : 'opacity-0',
              )}>
                {actions}
              </div>
            )
          )}
          {hideChevron !== true && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className="inline-grid h-6 w-6 place-items-center rounded border border-transparent text-foreground-tertiary transition-colors hover:bg-background-hover hover:text-foreground"
            >
              <CaretDown weight={DEFAULT_ICON_WEIGHT} className={cn(
                'h-4 w-4 transition-transform duration-150',
                expanded && 'rotate-180',
              )} />
            </button>
          )}
        </div>
      </div>
    );
  },
);

DetailCardRow.displayName = 'DetailCardRow';

/* ------------------------------------------------------------------ */
/*  DetailCardBody (expanded content)                                 */
/* ------------------------------------------------------------------ */

export type DetailCardBodyProps = HTMLAttributes<HTMLDivElement>;

export const DetailCardBody = forwardRef<HTMLDivElement, DetailCardBodyProps>(
  ({ className, ...rest }, ref) => {
    const { expanded, accent } = useContext(Ctx);
    if (!expanded) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'border-t border-border pl-7 pr-3.5 pb-3 pt-1',
          accent === 'primary' ? 'bg-primary-lighter' : 'bg-surface-low',
          className,
        )}
        {...rest}
      />
    );
  },
);

DetailCardBody.displayName = 'DetailCardBody';

/* ------------------------------------------------------------------ */
/*  DetailCardFooter (expanded footer actions)                        */
/* ------------------------------------------------------------------ */

export type DetailCardFooterProps = HTMLAttributes<HTMLDivElement>;

export const DetailCardFooter = forwardRef<HTMLDivElement, DetailCardFooterProps>(
  ({ className, ...rest }, ref) => {
    const { expanded, accent } = useContext(Ctx);
    if (!expanded) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'flex justify-end border-t border-border pl-7 pr-3.5 pt-2.5 pb-2.5',
          accent === 'primary' ? 'bg-primary-lighter' : 'bg-surface-low',
          className,
        )}
        {...rest}
      />
    );
  },
);

DetailCardFooter.displayName = 'DetailCardFooter';
