'use client';

import { BookMarked, BookText, LayoutGrid } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';
import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { useSidebar } from './SidebarContext';
import { SidebarNavItem } from './SidebarNavItem';

const itemDefinitions = [
  { key: 'projects', icon: LayoutGrid, href: '/projects', badge: '12' as string | undefined },
  { key: 'bblLibrary', icon: BookText, href: '/libraries/bbl', badge: undefined },
  { key: 'wkbLibrary', icon: BookMarked, href: '/libraries/wkb', badge: undefined },
] as const;

export function SidebarWorkspaceNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const t = useTranslations('sidebar');

  const labels = {
    projects: t('projects'),
    bblLibrary: t('bblLibrary'),
    wkbLibrary: t('wkbLibrary'),
  } as const;

  return (
    <div className={collapsed ? 'flex flex-col gap-0.5 px-0 py-2' : 'flex flex-col gap-0.5 px-3 py-2'}>
      {!collapsed && (
        <div className="mb-1.5 px-2.5 text-[9.5px] font-bold uppercase tracking-[0.14em] text-white/55">
          {t('workspace')}
        </div>
      )}
      {itemDefinitions.map(({ key, icon: Icon, href, badge }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <SidebarNavItem
            key={key}
            label={labels[key]}
            icon={Icon}
            collapsed={collapsed}
            active={isActive}
            href={href}
            {...(badge === undefined ? {} : { badge })}
          />
        );
      })}
    </div>
  );
}
