'use client';

import { HelpCircle, Settings, Shield } from 'lucide-react';
import { usePathname } from '@/i18n/navigation';
import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { useSidebar } from './SidebarContext';
import { SidebarNavItem } from './SidebarNavItem';

const itemDefinitions = [
  { key: 'admin', icon: Shield, href: undefined },
  { key: 'settings', icon: Settings, href: '/settings' },
  { key: 'help', icon: HelpCircle, href: undefined },
] as const;

export function SidebarNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const t = useTranslations('sidebar');

  const labels = {
    admin: t('adminConsole'),
    settings: t('settings'),
    help: t('helpAndDocs'),
  } as const;

  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1 pt-2">
      {itemDefinitions.map(({ key, icon: Icon, href }) => {
        const isActive = href === undefined ? false : pathname === href || pathname.startsWith(`${href}/`);

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
    </div>
  );
}
