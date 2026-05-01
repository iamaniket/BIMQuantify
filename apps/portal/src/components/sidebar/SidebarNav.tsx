'use client';

import { HelpCircle, Settings, Shield } from 'lucide-react';
import { usePathname } from 'next/navigation';
import type { JSX } from 'react';

import { useSidebar } from './SidebarContext';
import { SidebarNavItem } from './SidebarNavItem';

const items = [
  { key: 'admin', label: 'Admin console', icon: Shield, href: undefined },
  { key: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
  { key: 'help', label: 'Help & docs', icon: HelpCircle, href: undefined },
] as const;

export function SidebarNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-0.5 px-3 pb-1 pt-2">
      {items.map(({ key, label, icon: Icon, href }) => {
        const isActive = href === undefined ? false : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <SidebarNavItem
            key={key}
            label={label}
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
