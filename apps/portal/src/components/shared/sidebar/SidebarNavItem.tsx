'use client';

import type { AppIcon as LucideIcon } from '@bimstitch/ui';
import { Link } from '@/i18n/navigation';
import type { JSX, ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

type SidebarNavItemProps = {
  label: string;
  icon: LucideIcon;
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
  const expandedRow = `relative flex w-full items-center gap-[11px] rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${
    active
      ? 'bg-sidebar-active font-semibold text-sidebar-fg'
      : 'font-medium text-sidebar-fg-subtle hover:bg-sidebar-hover hover:text-sidebar-fg'
  }`;

  const collapsedRow = `mx-auto grid h-[34px] w-[34px] place-items-center rounded-lg transition-colors ${
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
