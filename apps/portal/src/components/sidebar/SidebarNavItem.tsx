'use client';

import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { JSX, ReactNode } from 'react';

import { Tooltip, TooltipContent, TooltipTrigger } from '@bimstitch/ui';

type SidebarNavItemProps = {
  label: string;
  icon: LucideIcon;
  collapsed: boolean;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  children?: ReactNode;
};

export function SidebarNavItem({
  label,
  icon: Icon,
  collapsed,
  active = false,
  href,
  onClick,
  children,
}: SidebarNavItemProps): JSX.Element {
  const className = `relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-body3 font-medium transition-colors ${
    active
      ? 'bg-white/15 font-semibold text-white'
      : 'text-white/80 hover:bg-white/10 hover:text-white'
  } ${collapsed ? 'justify-center px-0' : ''}`;

  const content = (
    <>
      {active && (
        <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-blue-400" />
      )}
      <Icon className={`h-[1.3rem] w-[1.3rem] shrink-0 ${active ? 'text-blue-400' : 'text-white/55'}`} />
      {!collapsed && <span>{label}</span>}
      {children}
    </>
  );

  const item = href ? (
    <Link href={href} aria-label={label} className={className}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
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