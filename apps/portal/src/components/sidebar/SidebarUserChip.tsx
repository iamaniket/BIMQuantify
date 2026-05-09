'use client';

import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { useSidebar } from './SidebarContext';

export function SidebarUserChip(): JSX.Element {
  const { collapsed, forceCollapsed } = useSidebar();
  const t = useTranslations('sidebar');
  const userName = t('userName');
  const userRole = t('userRole');

  return (
    <div
      className={`relative flex items-center gap-2.5 border-b border-white/12 ${
        collapsed ? 'justify-center px-0 py-3.5' : 'px-4 py-3.5'
      }`}
    >
      <div
        className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-primary-light text-[11px] font-extrabold text-primary"
        title={`${userName} · ${userRole}`}
      >
        LB
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold leading-[1.15] text-white">
            {userName}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-white/55">{userRole}</div>
        </div>
      )}
    </div>
  );
}
