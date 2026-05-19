'use client';

import { HelpCircle, LogOut, Settings, Shield } from 'lucide-react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useCallback, type JSX } from 'react';

import { useTranslations } from 'next-intl';

import { env } from '@/lib/env';
import { useAuth } from '@/providers/AuthProvider';

import { useSidebar } from './SidebarContext';
import { SidebarNavItem } from './SidebarNavItem';

const itemDefinitions = [
  { key: 'admin', icon: Shield, href: '/admin/organizations', requiresSuperuser: true },
  { key: 'settings', icon: Settings, href: '/settings', requiresSuperuser: false },
  { key: 'help', icon: HelpCircle, href: undefined, requiresSuperuser: false },
] as const;

export function SidebarNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const router = useRouter();
  const { tokens, setTokens, me } = useAuth();
  const t = useTranslations('sidebar');
  const isSuperuser = me?.user.is_superuser === true;

  const labels = {
    admin: t('adminConsole'),
    settings: t('settings'),
    help: t('helpAndDocs'),
    signOut: t('signOut'),
  } as const;

  const handleSignOut = useCallback(() => {
    const accessToken = tokens?.access_token;
    const refreshToken = tokens?.refresh_token;

    if (accessToken !== undefined) {
      void fetch(`${env.NEXT_PUBLIC_API_URL}/auth/logout`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ refresh_token: refreshToken ?? null }),
      }).catch(() => {
        // Best-effort: token revocation is server-side hygiene; UI logout must still proceed.
      });
    }

    setTokens(null);
    router.replace('/login');
  }, [tokens, setTokens, router]);

  return (
    <div
      className={
        collapsed
          ? 'flex flex-col gap-0.5 px-0 pb-1 pt-2'
          : 'flex flex-col gap-0.5 px-3 pb-1 pt-2'
      }
    >
      {itemDefinitions.map(({ key, icon: Icon, href, requiresSuperuser }) => {
        if (requiresSuperuser && !isSuperuser) return null;
        // The admin link points at /admin/organizations but we want the whole
        // /admin/* tree to show as active.
        const adminPrefix = '/admin';
        const isActive =
          href === undefined
            ? false
            : key === 'admin'
              ? pathname === adminPrefix || pathname.startsWith(`${adminPrefix}/`)
              : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <SidebarNavItem
            key={key}
            label={labels[key]}
            icon={Icon}
            collapsed={collapsed}
            active={isActive}
            {...(href === undefined ? {} : { href })}
          />
        );
      })}
      <SidebarNavItem
        label={labels.signOut}
        icon={LogOut}
        collapsed={collapsed}
        onClick={handleSignOut}
      />
    </div>
  );
}
