'use client';

import { LayoutGrid } from '@bimdossier/ui/icons';
import { usePathname } from '@/i18n/navigation';
import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { Eyebrow } from '@bimdossier/ui';

import { useSidebar } from './SidebarContext';
import { SidebarNavItem } from './SidebarNavItem';

/**
 * Workspace nav for free (org-less) users — only "Projects", which for a free
 * user lists their uploaded free models (the `/projects` page branches on
 * `isPooled`). Deliberately does NOT call `useProjects()` — the org-scoped
 * `GET /projects` 409s without an org — and omits Certificates / Templates /
 * Calendar. Sibling of `SidebarWorkspaceNav`.
 */
export function SidebarPooledNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const t = useTranslations('sidebar');

  const isActive =
    pathname === '/projects'
    || pathname.startsWith('/projects/');

  return (
    <div className={collapsed ? 'flex flex-col gap-0.5 px-0 py-2' : 'flex flex-col gap-0.5 px-3 py-2'}>
      {!collapsed && (
        <Eyebrow as="div" tone="tertiary" className="mb-1.5 px-2.5 text-white/55">
          {t('workspace')}
        </Eyebrow>
      )}
      <SidebarNavItem
        label={t('projects')}
        icon={LayoutGrid}
        collapsed={collapsed}
        active={isActive}
        href="/projects"
      />
    </div>
  );
}
