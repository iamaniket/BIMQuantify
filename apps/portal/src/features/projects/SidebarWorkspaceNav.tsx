'use client';

import { FileBadge, Layers, LayoutGrid } from '@bimstitch/ui/icons';
import { usePathname } from '@/i18n/navigation';
import type { JSX } from 'react';

import { useTranslations } from 'next-intl';

import { Eyebrow } from '@bimstitch/ui';

import { useSidebar } from '@/components/shared/sidebar/SidebarContext';
import { SidebarNavItem } from '@/components/shared/sidebar/SidebarNavItem';

import { useProjects } from './useProjects';

const itemDefinitions = [
  { key: 'projects', icon: LayoutGrid, href: '/projects' },
  { key: 'certificates', icon: FileBadge, href: '/certificates' },
  { key: 'templates', icon: Layers, href: '/templates' },
] as const;

export function SidebarWorkspaceNav(): JSX.Element {
  const { collapsed } = useSidebar();
  const pathname = usePathname();
  const t = useTranslations('sidebar');
  const { data: projects } = useProjects();
  const projectsCountBadge = projects?.length;

  const labels = {
    projects: t('projects'),
    certificates: t('certificates'),
    templates: t('templates'),
  } as const;

  return (
    <div className={collapsed ? 'flex flex-col gap-0.5 px-0 py-2' : 'flex flex-col gap-0.5 px-3 py-2'}>
      {!collapsed && (
        <Eyebrow as="div" tone="tertiary" className="mb-1.5 px-2.5 text-white/55">
          {t('workspace')}
        </Eyebrow>
      )}
      {itemDefinitions.map(({ key, icon: Icon, href }) => {
        const isActive = pathname === href || pathname.startsWith(`${href}/`);
        const badge = key === 'projects' ? projectsCountBadge : undefined;
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
