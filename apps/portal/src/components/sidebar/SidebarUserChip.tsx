'use client';

import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';

function toInitials(nameOrEmail: string): string {
  const words = nameOrEmail.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    return words[0]!.slice(0, 2).toUpperCase();
  }
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
}

export function SidebarUserChip(): JSX.Element {
  const { collapsed } = useSidebar();
  const { me, activeMembership } = useAuth();
  const tOrgSwitcher = useTranslations('org.switcher');

  const fallbackName = me?.user.email ?? 'User';
  const userName = me?.user.full_name?.trim() || fallbackName;
  const userRole =
    activeMembership === null
      ? fallbackName
      : activeMembership.is_org_admin
        ? `${activeMembership.organization_name} · ${tOrgSwitcher('adminBadge')}`
        : activeMembership.organization_name;
  const initials = toInitials(userName);

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
        {initials}
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
