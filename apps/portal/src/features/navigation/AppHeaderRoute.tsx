'use client';

import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { AppHeader, type Crumb } from '@/components/shared/header/AppHeader';
import { useAppHeaderOverrides } from '@/components/shared/header/AppHeaderContext';
import { NotificationsBell } from '@/components/shared/header/NotificationsBell';
import { useSidebar } from '@/components/shared/sidebar/SidebarContext';
import { useModels } from '@/features/models/useModels';
import { ModelSwitcher } from '@/features/navigation/ModelSwitcher';
import { useProject } from '@/features/projects/useProject';
import { usePathname } from '@/i18n/navigation';

type RouteParams = {
  projectId: string | undefined;
  modelId: string | undefined;
  fileId: string | undefined;
};

type CrumbT = ReturnType<typeof useTranslations>;

const VIEWER_RE = /^\/projects\/[^/]+\/models\/[^/]+\/viewer\/[^/]+/;
const REPORT_RE = /^\/projects\/[^/]+\/reports\/[^/]+/;
const PROJECT_DETAIL_RE = /^\/projects\/[^/]+$/;
const ADMIN_ORG_DETAIL_RE = /^\/admin\/organizations\/[^/]+$/;

function resolveCrumbs(
  pathname: string,
  ctx: {
    projectId: string;
    projectName: string | null;
    modelName: string | null;
  },
  t: CrumbT,
): Crumb[] {
  const { projectId, projectName, modelName } = ctx;
  const projectsHref = '/projects';
  const projectHref = projectId.length > 0 ? `/projects/${projectId}` : projectsHref;

  if (VIEWER_RE.test(pathname)) {
    return [
      { label: t('projects'), href: projectsHref },
      { label: projectName ?? t('project'), href: projectHref },
      { label: modelName ?? t('model'), href: projectHref },
    ];
  }
  if (REPORT_RE.test(pathname)) {
    return [
      { label: t('projects'), href: projectsHref },
      { label: projectName ?? t('project'), href: projectHref },
      { label: t('report'), href: undefined },
    ];
  }
  if (PROJECT_DETAIL_RE.test(pathname)) {
    return [
      { label: t('projects'), href: projectsHref },
      { label: projectName ?? t('project'), href: undefined },
    ];
  }
  if (pathname.startsWith('/projects')) {
    return [{ label: t('projects'), href: undefined }];
  }
  if (pathname.startsWith('/certificates')) {
    return [{ label: t('certificates'), href: undefined }];
  }
  if (pathname.startsWith('/templates')) {
    return [{ label: t('templates'), href: undefined }];
  }
  if (pathname.startsWith('/settings')) {
    return [{ label: t('settings'), href: undefined }];
  }
  // Admin shell — the detail page replaces these via useHeaderCrumbsOverride
  // so the tenant's actual name shows up; the rest get static crumbs.
  if (ADMIN_ORG_DETAIL_RE.test(pathname)) {
    return [
      { label: t('adminConsole'), href: '/admin/organizations' },
      { label: t('tenant'), href: undefined },
    ];
  }
  if (pathname.startsWith('/admin')) {
    return [{ label: t('adminConsole'), href: undefined }];
  }
  return [{ label: t('appName'), href: undefined }];
}

export function AppHeaderRoute(): JSX.Element {
  const t = useTranslations('breadcrumbs');
  const pathname = usePathname();
  const params = useParams<RouteParams>();
  const { setMobileOpen } = useSidebar();
  const projectId = params.projectId ?? '';
  const modelId = params.modelId ?? '';

  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);

  const { status, crumbs: crumbsOverride } = useAppHeaderOverrides();

  const projectName: string | null = projectQuery.data === undefined
    ? null
    : projectQuery.data.name;
  let modelName: string | null = null;
  if (modelsQuery.data !== undefined) {
    const found = modelsQuery.data.find((m) => m.id === modelId);
    if (found !== undefined) modelName = found.name;
  }

  const isViewerRoute = VIEWER_RE.test(pathname);
  const crumbs = crumbsOverride
    ?? resolveCrumbs(pathname, { projectId, projectName, modelName }, t);

  return (
    <AppHeader
      crumbs={crumbs}
      status={status}
      action={null}
      onMenuOpen={() => { setMobileOpen(true); }}
      rightSlot={
        <>
          {isViewerRoute && modelId.length > 0 ? (
            <ModelSwitcher
              projectId={projectId}
              currentModelId={modelId}
              currentModelName={modelName ?? t('model')}
            />
          ) : null}
          <NotificationsBell />
        </>
      }
    />
  );
}
