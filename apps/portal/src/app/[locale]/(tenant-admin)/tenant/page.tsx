'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import { Skeleton } from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import { OrgDetailView } from '@/features/org-detail';
import type { OrgDetailData } from '@/features/org-detail';
import { useAuth } from '@/providers/AuthProvider';

export default function TenantAdminPage(): JSX.Element {
  const t = useTranslations('tenantAdmin');
  const { activeMembership } = useAuth();
  const organizationId = activeMembership?.organization_id ?? null;

  const membersQuery = useOrgMembers(organizationId ?? '', {});
  const auditQuery = useOrgAuditLog(organizationId ?? '', { limit: 50 });

  const crumbs = useMemo(
    () => (activeMembership === null
      ? null
      : [
        { label: t('crumb'), href: undefined },
        { label: activeMembership.organization_name, href: undefined },
      ]),
    [activeMembership, t],
  );
  useHeaderCrumbsOverride(crumbs);

  const [inviteOpen, setInviteOpen] = useState(false);

  if (activeMembership === null || organizationId === null) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="px-6 py-6">
          <Skeleton className="mb-6 h-10 w-80" />
          <Skeleton className="h-64 w-full" />
        </div>
      </main>
    );
  }

  if (!activeMembership.is_org_admin) {
    return (
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="px-6 py-6">
          <p className="text-body3 text-error">{t('notAdmin')}</p>
        </div>
      </main>
    );
  }

  const org: OrgDetailData = {
    id: activeMembership.organization_id,
    name: activeMembership.organization_name,
    status: activeMembership.organization_status,
    seatLimit: activeMembership.seat_limit,
    seatCountUsed: activeMembership.seat_count_used,
    schemaName: null,
    createdAt: null,
    provisionedAt: null,
  };

  return (
    <>
      <OrgDetailView
        org={org}
        members={membersQuery.data ?? []}
        membersLoading={membersQuery.isLoading}
        membersError={membersQuery.isError}
        auditEntries={auditQuery.data ?? []}
        auditLoading={auditQuery.isLoading}
        auditError={auditQuery.isError}
        onInvite={() => { setInviteOpen(true); }}
      />
      <InviteMemberDialog
        organizationId={organizationId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </>
  );
}
