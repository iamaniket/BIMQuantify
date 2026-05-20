'use client';

import { UserPlus } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Button, EmptyState, PageHeader, Skeleton } from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { ApiError } from '@/lib/api/client';
import { useProject } from '@/features/projects/useProject';
import { AddProjectMemberDialog } from '@/features/projects/members/AddProjectMemberDialog';
import { ProjectMembersList } from '@/features/projects/members/ProjectMembersList';
import { useProjectMembers } from '@/features/projects/members/useProjectMembers';
import { useAuth } from '@/providers/AuthProvider';

type AccessMember = {
  user_id: string;
  role: string;
  email: string;
  full_name: string | null;
  created_at: string;
};

export default function ProjectAccessPage(): JSX.Element {
  const t = useTranslations('projectAccess');
  const params = useParams();
  const rawProjectId = params['projectId'];
  const projectId = typeof rawProjectId === 'string' ? rawProjectId : '';

  const { me, activeMembership } = useAuth();
  const projectQuery = useProject(projectId);
  const membersQuery = useProjectMembers(projectId) as UseQueryResult<AccessMember[]>;

  const [addOpen, setAddOpen] = useState(false);

  const projectName = projectQuery.data?.name;
  const crumbs = useMemo(
    () => (projectName === undefined
      ? null
      : [
        { label: 'Projects', href: '/projects' },
        { label: projectName, href: `/projects/${projectId}` },
        { label: t('crumb'), href: undefined },
      ]),
    [projectName, projectId, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const currentUserId = me === null ? null : me.user.id;
  let isOrgAdmin = false;
  if (activeMembership !== null) {
    isOrgAdmin = activeMembership.is_org_admin;
  }

  let isSuperuser = false;
  if (me !== null) {
    isSuperuser = me.user.is_superuser;
  }
  const members = useMemo(
    () => membersQuery.data ?? [],
    [membersQuery.data],
  );

  const isProjectOwner = useMemo(() => {
    if (currentUserId === null) return false;
    return members.some((m) => m.user_id === currentUserId && m.role === 'owner');
  }, [currentUserId, members]);

  // Server enforces this gate too; the client check is just to hide the
  // affordances that would error anyway.
  const canManage = isSuperuser || isOrgAdmin || isProjectOwner;

  if (projectQuery.isLoading || membersQuery.isLoading) {
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="mb-6 h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (projectQuery.isError) {
    const { error } = projectQuery;
    const isNotFound = error instanceof ApiError && error.status === 404;
    return (
      <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
        <div
          role="alert"
          className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body2 text-error"
        >
          {isNotFound ? t('errors.notFound') : t('errors.loadFailed')}
        </div>
      </main>
    );
  }

  const project = projectQuery.data;
  const activeOrgId = activeMembership === null ? null : activeMembership.organization_id;
  if (project === undefined) {
    return <main className="flex flex-1 items-center justify-center" />;
  }

  let membersContent: JSX.Element;
  if (membersQuery.isError) {
    membersContent = (
      <div
        role="alert"
        className="rounded-md border border-error-light bg-error-lighter px-4 py-3 text-body3 text-error"
      >
        {t('errors.membersLoadFailed')}
      </div>
    );
  } else if (members.length === 0) {
    membersContent = (
      <EmptyState
        icon={UserPlus}
        title={t('emptyState.title')}
        description={t('emptyState.description')}
        action={canManage ? (
          <Button onClick={() => { setAddOpen(true); }}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {t('addMember')}
          </Button>
        ) : undefined}
        className={undefined}
      />
    );
  } else {
    membersContent = (
      <ProjectMembersList
        projectId={projectId}
        members={members}
        canManage={canManage}
      />
    );
  }

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={canManage ? (
          <Button onClick={() => { setAddOpen(true); }}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {t('addMember')}
          </Button>
        ) : undefined}
        className={undefined}
      />

      {!canManage && (
        <div
          className="mb-4 rounded-md border border-border bg-surface-low px-3 py-2 text-body3 text-foreground-secondary"
          role="status"
        >
          {t('readOnlyNotice')}
        </div>
      )}

      {membersContent}

      {canManage && activeOrgId !== null && (
        <AddProjectMemberDialog
          projectId={projectId}
          organizationId={activeOrgId}
          existingMembers={members}
          open={addOpen}
          onOpenChange={setAddOpen}
        />
      )}
    </main>
  );
}
