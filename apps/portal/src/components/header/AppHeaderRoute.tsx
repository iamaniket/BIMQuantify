'use client';

import { useParams } from 'next/navigation';
import { type JSX } from 'react';

import { useModels } from '@/features/models/useModels';
import { useProject } from '@/features/projects/useProject';
import { usePathname } from '@/i18n/navigation';

import { AppHeader, type Crumb } from './AppHeader';
import { useAppHeaderOverrides } from './AppHeaderContext';
import { NotificationsBell } from './NotificationsBell';

type RouteParams = {
  projectId: string | undefined;
  modelId: string | undefined;
  fileId: string | undefined;
};

const VIEWER_RE = /^\/projects\/[^/]+\/models\/[^/]+\/viewer\/[^/]+/;
const REPORT_RE = /^\/projects\/[^/]+\/reports\/[^/]+/;
const PROJECT_DETAIL_RE = /^\/projects\/[^/]+$/;

function resolveCrumbs(
  pathname: string,
  ctx: {
    projectId: string;
    projectName: string | null;
    modelName: string | null;
  },
): Crumb[] {
  const { projectId, projectName, modelName } = ctx;
  const projectsHref = '/projects';
  const projectHref = projectId.length > 0 ? `/projects/${projectId}` : projectsHref;

  if (VIEWER_RE.test(pathname)) {
    return [
      { label: 'Projects', href: projectsHref },
      { label: projectName ?? 'Project', href: projectHref },
      { label: modelName ?? 'Model', href: projectHref },
    ];
  }
  if (REPORT_RE.test(pathname)) {
    return [
      { label: 'Projects', href: projectsHref },
      { label: projectName ?? 'Project', href: projectHref },
      { label: 'Report', href: undefined },
    ];
  }
  if (PROJECT_DETAIL_RE.test(pathname)) {
    return [
      { label: 'Projects', href: projectsHref },
      { label: projectName ?? 'Project', href: undefined },
    ];
  }
  if (pathname.startsWith('/projects')) {
    return [{ label: 'Projects', href: undefined }];
  }
  if (pathname.startsWith('/settings')) {
    return [{ label: 'Settings', href: undefined }];
  }
  return [{ label: 'BimStitch', href: undefined }];
}

export function AppHeaderRoute(): JSX.Element {
  const pathname = usePathname();
  const params = useParams<RouteParams>();
  const projectId = params.projectId ?? '';
  const modelId = params.modelId ?? '';

  const projectQuery = useProject(projectId);
  const modelsQuery = useModels(projectId);

  const { status } = useAppHeaderOverrides();

  const projectName: string | null = projectQuery.data === undefined
    ? null
    : projectQuery.data.name;
  let modelName: string | null = null;
  if (modelsQuery.data !== undefined) {
    const found = modelsQuery.data.find((m) => m.id === modelId);
    if (found !== undefined) modelName = found.name;
  }

  const crumbs = resolveCrumbs(pathname, { projectId, projectName, modelName });

  return (
    <AppHeader
      crumbs={crumbs}
      status={status}
      action={null}
      rightSlot={<NotificationsBell />}
    />
  );
}
