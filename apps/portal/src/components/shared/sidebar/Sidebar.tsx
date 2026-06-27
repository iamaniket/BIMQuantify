'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { X } from '@bimdossier/ui/icons';
import { TooltipProvider } from '@bimdossier/ui';

import { useIsMobile } from '@/hooks/useIsMobile';
import { DossierLogo } from '@/components/shared/charts/StitchLogo';
import { SidebarWorkspaceNav } from '@/features/projects/SidebarWorkspaceNav';

import { SidebarCollapseToggle } from './SidebarCollapseToggle';
import { SidebarNav } from './SidebarNav';
import { SidebarTenantCard } from './SidebarTenantCard';
import { SidebarUserChip } from './SidebarUserChip';
import { useSidebar } from './SidebarContext';

const SIDEBAR_BG = 'linear-gradient(180deg, var(--brand-gradient-start) 0%, var(--brand-gradient-end) 100%)';

function BrandFooter({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <div
      className={`border-t border-white/12 ${
        collapsed ? 'flex justify-center px-0 py-3' : 'flex items-center gap-2.5 px-4 py-3'
      }`}
    >
      <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-md border border-white/[0.28] bg-white/[0.16]">
        <DossierLogo size={17} color="#fff" />
      </div>
      {!collapsed && (
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold leading-[1.1] tracking-tight text-white">
            {'BimDossier'}
          </div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/55">
            {'NL · Wkb + BBL'}
          </div>
        </div>
      )}
    </div>
  );
}

export function Sidebar(): JSX.Element {
  const { collapsed, forceCollapsed, hydrated, transitionsReady, mobileOpen, setMobileOpen } = useSidebar();
  const t = useTranslations('common');
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        {mobileOpen && (
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-black/40"
            onClick={() => { setMobileOpen(false); }}
          />
        )}

        {/* Drawer */}
        <aside
          className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-white/12 text-white/[0.82]"
          style={{
            background: SIDEBAR_BG,
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 220ms cubic-bezier(.4,0,.2,1)',
          }}
        >
          <TooltipProvider delayDuration={200}>
            {/* Close button */}
            <button
              type="button"
              onClick={() => { setMobileOpen(false); }}
              aria-label={t('a11y.closeNavigation')}
              className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <SidebarUserChip />
            <SidebarTenantCard />
            <SidebarWorkspaceNav />

            <div className="flex-1" />

            <div className="border-t border-white/12">
              <SidebarNav />
            </div>

            <BrandFooter collapsed={false} />
          </TooltipProvider>
        </aside>
      </>
    );
  }

  // Desktop: original inline sidebar
  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-white/12 text-white/[0.82]"
      style={{
        width: collapsed ? 47 : 220,
        background: SIDEBAR_BG,
        transition: transitionsReady ? 'width 220ms cubic-bezier(.4,0,.2,1)' : 'none',
      }}
      data-hydrated={hydrated}
    >
      <TooltipProvider delayDuration={200}>
        <SidebarUserChip />
        {!forceCollapsed && <SidebarCollapseToggle />}
        <SidebarTenantCard />
        <SidebarWorkspaceNav />

        <div className="flex-1" />

        <div className="border-t border-white/12">
          <SidebarNav />
        </div>

        <BrandFooter collapsed={collapsed} />
      </TooltipProvider>
    </aside>
  );
}
