'use client';

import type { LucideIcon } from 'lucide-react';
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

const ACCENT = '#5fa8ff';

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
      ? 'bg-white/[0.16] font-semibold text-white'
      : 'font-medium text-white/[0.82] hover:bg-white/10 hover:text-white'
  }`;

  const collapsedRow = `mx-auto grid h-[34px] w-[34px] place-items-center rounded-lg transition-colors ${
    active ? 'bg-white/[0.16] text-white' : 'text-white/[0.82] hover:bg-white/10 hover:text-white'
  }`;

  const className = collapsed ? collapsedRow : expandedRow;

  const iconClassName = `h-[18px] w-[18px] shrink-0 ${active ? '' : ''}`;
  const iconStyle = active ? { color: '#ffffff' } : { color: 'rgba(255,255,255,0.55)' };

  const content = (
    <>
      <Icon className={iconClassName} style={iconStyle} />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {!collapsed && badge !== undefined && (
        <span className="rounded-full bg-white/10 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.04em] text-white/60">
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
