'use client';

import { useEffect, useState, type JSX } from 'react';

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { getAvatarUrl } from '@/lib/api/profile';
import { useAuth } from '@/providers/AuthProvider';

import { UserAvatar } from '@/components/shared/UserAvatar';
import { useSidebar } from './SidebarContext';

export function SidebarUserChip(): JSX.Element {
  const { collapsed } = useSidebar();
  const { me, activeMembership, tokens } = useAuth();
  const t = useTranslations('sidebar');
  const fallbackName = me?.user.email ?? 'User';
  const userName = me?.user.full_name?.trim() || fallbackName;
  let roleLabel = '';
  if (activeMembership) {
    roleLabel = activeMembership.is_org_admin ? 'Admin' : 'Member';
  }

  const pendingCount = me?.pending_invitations_count ?? 0;
  const avatarKey = me?.user.avatar_url;
  const accessToken = tokens?.access_token ?? null;

  const [avatarSrc, setAvatarSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!avatarKey || accessToken === null) {
      setAvatarSrc(null);
      return;
    }
    void getAvatarUrl(accessToken).then(setAvatarSrc).catch(() => { setAvatarSrc(null); });
  }, [avatarKey, accessToken]);

  return (
    <Link
      href="/account"
      aria-label={t('account')}
      className={`relative flex h-[52px] items-center gap-2.5 border-b border-white/12 transition-colors hover:bg-white/10 ${
        collapsed ? 'justify-center px-0' : 'px-4'
      }`}
    >
      <div className="relative shrink-0">
        <UserAvatar
          name={userName}
          src={avatarSrc}
          className="h-[30px] w-[30px] text-caption font-extrabold"
        />
        {pendingCount > 0 && (
          <span className="absolute -right-[3px] -top-[3px] grid h-[14px] min-w-[14px] place-items-center rounded-full border-[1.5px] border-sidebar-surface bg-[var(--header-notify-dot)] px-[3px] text-micro font-extrabold leading-[14px] tabular-nums text-white">
            {pendingCount > 9 ? '9+' : String(pendingCount)}
          </span>
        )}
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold leading-[1.15] text-white">
            {userName}
          </div>
          {roleLabel && (
            <div className="mt-0.5 truncate text-[10px] text-white/55">{roleLabel}</div>
          )}
        </div>
      )}
    </Link>
  );
}
