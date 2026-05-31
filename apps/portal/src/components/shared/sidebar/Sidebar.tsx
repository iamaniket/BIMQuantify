'use client';

import type { JSX } from 'react';

import { TooltipProvider } from '@bimstitch/ui';

import { StitchLogo } from '@/components/shared/charts/StitchLogo';
import { SidebarWorkspaceNav } from '@/features/projects/SidebarWorkspaceNav';

import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { SidebarNav } from './SidebarNav';
import { SidebarTenantCard } from './SidebarTenantCard';
import { SidebarUserChip } from './SidebarUserChip';
import { useSidebar } from './SidebarContext';

export function Sidebar(): JSX.Element {
  const { collapsed, forceCollapsed, hydrated, transitionsReady } = useSidebar();

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-white/12 text-white/[0.82]"
      style={{
        width: collapsed ? 51 : 232,
        background: 'linear-gradient(180deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)',
        transition: transitionsReady ? 'width 220ms cubic-bezier(.4,0,.2,1)' : 'none',
        // Disable animation during hydration to prevent unwanted opening/closing
      }}
      data-hydrated={hydrated}
    >
      <TooltipProvider delayDuration={200}>
        {/* Account chip (top) with collapse toggle */}
        <SidebarUserChip />

        {/* Collapse toggle on sidebar edge */}
        {!forceCollapsed && <SidebarCollapseToggle />}

        {/* Tenant */}
        <SidebarTenantCard />

        {/* Workspace nav */}
        <SidebarWorkspaceNav />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bottom nav */}
        <div className="border-t border-white/12">
          <SidebarNav />
        </div>

        {/* BimStitch brand footer */}
        <div
          className={`border-t border-white/12 ${
            collapsed ? 'flex justify-center px-0 py-3' : 'flex items-center gap-2.5 px-4 py-3'
          }`}
        >
          <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-white/[0.28] bg-white/[0.16]">
            <StitchLogo size={17} color="#fff" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold leading-[1.1] tracking-tight text-white">
                BimStitch
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">
                Wkb 2026.1
              </div>
            </div>
          )}
        </div>
      </TooltipProvider>
    </aside>
  );
}
