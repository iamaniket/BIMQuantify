'use client';

import { useRef, type JSX, type ReactNode } from 'react';

import { Badge, Skeleton } from '@bimdossier/ui';
import { ArrowRight } from '@bimdossier/ui/icons';

import { Link } from '@/i18n/navigation';
import { useFitCount } from '@/lib/hooks/useFitCount';

type Props = {
  /** Header tile icon element (consumer sets its `h-/w-` size). */
  icon: ReactNode;
  label: string;
  count: number;
  /** The entity board page the "View all" link navigates to. */
  boardHref: string;
  viewAllLabel: string;
  /** Permission-gated create affordance, shown compactly in the header corner. */
  headerAction?: ReactNode;
  /** Shown when there are no items to preview. */
  emptyLabel: string;
  isLoading: boolean;
  isEmpty: boolean;
  /** Fixed row height in px (rows must render at this height for the fit to be exact). */
  rowHeightPx: number;
  /** Vertical gap between rows in px (default 2). */
  gapPx?: number;
  maxRows: number;
  /** Render the rows; receives how many fit the measured body height. */
  children: (visibleCount: number) => ReactNode;
};

/**
 * Chrome for an entity launcher card on the project-detail page: an icon-tile
 * header (icon + label + count + a "View all" link and a compact create button
 * in the corner), a divider, and a body that previews recent items. The body is
 * measured and the row count adapts to the available height — fewer rows when
 * the card is short, up to `maxRows` when it's tall.
 *
 * Composition over base primitives (`IconTile`, `Badge`, `MediaRow` supplied by
 * the caller); props-only and entity-agnostic so the other launcher cards can
 * adopt it.
 */
export function LauncherPanel({
  icon, label, count, boardHref, viewAllLabel, headerAction,
  emptyLabel, isLoading, isEmpty, rowHeightPx, gapPx = 2, maxRows, children,
}: Props): JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  const visible = useFitCount(bodyRef, {
    rowHeight: rowHeightPx, gap: gapPx, min: 1, max: maxRows,
  });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-body3 font-semibold text-foreground">{label}</span>
          {/* Count circle right beside the label, matching the tab-nav count chips. */}
          <Badge variant="default" size="md" bordered={false} className="shrink-0">{count}</Badge>
        </div>
        <div className="flex-1" />
        <Link
          href={boardHref}
          className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-caption font-medium text-foreground-secondary transition-colors hover:text-foreground [&>svg]:h-3.5 [&>svg]:w-3.5"
        >
          {icon}
          {viewAllLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
        {headerAction !== undefined && <div className="shrink-0">{headerAction}</div>}
      </header>

      <div className="h-px shrink-0 bg-border" />

      <div className="min-h-0 flex-1 overflow-hidden p-1.5">
        <div ref={bodyRef} className="flex h-full flex-col" style={{ gap: `${gapPx}px` }}>
          {isLoading ? (
            Array.from({ length: Math.min(3, maxRows) }).map((_, i) => (
              <div key={i} style={{ height: rowHeightPx }}>
                <Skeleton className="h-full w-full" />
              </div>
            ))
          ) : isEmpty ? (
            <p className="m-auto px-2 text-center text-caption text-foreground-tertiary">{emptyLabel}</p>
          ) : (
            children(visible)
          )}
        </div>
      </div>
    </section>
  );
}
