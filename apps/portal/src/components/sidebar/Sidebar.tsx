'use client';

import type { JSX } from 'react';
import { usePathname } from '@/i18n/navigation';

import { House } from 'lucide-react';

import { TooltipProvider } from '@bimstitch/ui';

import { StitchLogo } from '@/components/charts/StitchLogo';

import { SidebarNavItem } from './SidebarNavItem';
import { useSidebar } from './SidebarContext';
import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { SidebarTenantCard } from './SidebarTenantCard';
import { SidebarNav } from './SidebarNav';
import { SidebarUserChip } from './SidebarUserChip';

export function Sidebar(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const isHomeActive = pathname === '/projects';

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-white/12 bg-gradient-to-b from-primary to-primary-hover text-white/80 transition-[width] duration-200 dark:from-[#1e3e72] dark:to-[#16315e]"
      style={{ width: collapsed ? 64 : 232 }}
    >
      <TooltipProvider delayDuration={200}>
        <div
          className={`relative border-b border-white/12 ${collapsed ? 'px-2 py-3.5' : 'px-3 py-3.5'}`}
        >
          <SidebarNavItem
            label="Home"
            icon={House}
            href="/projects"
            collapsed={collapsed}
            active={isHomeActive}
          />
          <SidebarCollapseToggle />
        </div>

        {/* Tenant */}
        <SidebarTenantCard />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom nav */}
        <div className="border-t border-white/12">
          <SidebarNav />
        </div>

        {/* User */}
        <SidebarUserChip />

        <div
          className={`border-t border-white/12 ${
            collapsed ? 'flex justify-center px-0 py-3.5' : 'flex items-center gap-2.5 px-4 py-3.5'
          }`}
        >
          <div className="grid h-8 w-8 shrink-0 place-items-center">
            <StitchLogo size={22} color="#fff" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-body2 font-semibold leading-none tracking-tight text-white">
                BimStitch
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">
                Wkb 2026.1
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>
    </aside>
  );
}
