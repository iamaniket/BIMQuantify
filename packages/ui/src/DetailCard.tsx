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

type DetailCardCtx = {
  expanded: boolean;
  onToggle: () => void;
};

const Ctx = createContext<DetailCardCtx>({
  expanded: false,
  onToggle: () => {},
});

/* ------------------------------------------------------------------ */
/*  DetailCard (root)                                                 */
/* ------------------------------------------------------------------ */

export type DetailCardProps = HTMLAttributes<HTMLDivElement> & {
  expanded: boolean;
  onToggle: () => void;
};

export const DetailCard = forwardRef<HTMLDivElement, DetailCardProps>(
  ({ expanded, onToggle, className, children, ...rest }, ref) => (
    <Ctx.Provider value={{ expanded, onToggle }}>
      <div
        ref={ref}
        className={cn(
          'border-t border-border transition-colors',
          expanded && 'bg-surface-low',
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    </Ctx.Provider>
  ),
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
  hideChevron?: boolean | undefined;
};

export const DetailCardRow = forwardRef<HTMLDivElement, DetailCardRowProps>(
  ({ media, actions, aside, hideChevron, className, children, ...rest }, ref) => {
    const { expanded, onToggle } = useContext(Ctx);
    const [hovered, setHovered] = useState(false);

    const gridTemplateColumns = [
      media !== undefined ? '40px' : null,
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
            ? 'border-l-2 border-l-primary pl-[10px]'
            : 'border-l-2 border-l-transparent',
          !expanded && hovered && 'bg-background-hover',
          className,
        )}
        style={{ gridTemplateColumns }}
        {...rest}
      >
        {media !== undefined && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center">
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
          {/* Top actions only when collapsed — once expanded, the footer owns them. */}
          {actions !== undefined && !expanded && (
            <div className={cn(
              'flex items-center gap-1.5 transition-all',
              hovered ? 'opacity-100' : 'opacity-0',
            )}>
              {actions}
            </div>
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
    const { expanded } = useContext(Ctx);
    if (!expanded) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'border-t border-border bg-surface-low pl-7 pr-3.5 pb-3 pt-1',
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
    const { expanded } = useContext(Ctx);
    if (!expanded) return null;

    return (
      <div
        ref={ref}
        className={cn(
          'flex justify-end border-t border-border bg-surface-low pl-7 pr-3.5 pt-2.5 pb-2.5',
          className,
        )}
        {...rest}
      />
    );
  },
);

DetailCardFooter.displayName = 'DetailCardFooter';
