'use client';

import type { AppIcon } from '@bimdossier/ui';
import { Link } from '@/i18n/navigation';
import type { JSX, ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger, controlSizeStyles } from '@bimdossier/ui';

type SidebarNavItemProps = {
  label: string;
  icon: AppIcon;
  collapsed: boolean;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  badge?: string | number;
  children?: ReactNode;
};

export function SidebarNavItem({
  label,
  icon: Icon,
  collapsed,
  active = false,
  href,
  onClick,
  badge,
  children,
}: SidebarNavItemProps): JSX.Element {
  // Use md size (h-8) for consistent control height
  const expandedRow = `relative flex w-full items-center gap-[11px] rounded-lg px-2.5 ${controlSizeStyles.md} text-left ${
    active
      ? 'bg-sidebar-active font-semibold text-sidebar-fg'
      : 'font-medium text-sidebar-fg-subtle hover:bg-sidebar-hover hover:text-sidebar-fg'
  }`;

  // Collapsed mode maintains square aspect ratio (w-8 h-8)
  const collapsedRow = `mx-auto grid ${controlSizeStyles.md} w-8 place-items-center rounded-lg transition-colors ${
    active ? 'bg-sidebar-active text-sidebar-fg' : 'text-sidebar-fg-subtle hover:bg-sidebar-hover hover:text-sidebar-fg'
  }`;

  const className = collapsed ? collapsedRow : expandedRow;

  const content = (
    <>
      <Icon className={`h-5 w-5 shrink-0 ${active ? 'text-sidebar-fg' : 'text-sidebar-fg-muted'}`} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && (
        <span className="rounded-full bg-sidebar-hover px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-sidebar-fg-muted">
          {badge}
        </span>
      )}
      {children}
    </>
  );

  const item = href ? (
    <Link href={href} aria-label={label} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={className}>
      {content}
    </button>
  );

  if (!collapsed) {
    return item;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
