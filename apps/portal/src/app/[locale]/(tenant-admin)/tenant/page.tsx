'use client';

import { Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type JSX } from 'react';

import { Button, Skeleton } from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import { OrgDetailView, TenantOrgEditDialog } from '@/features/org-detail';
import type { OrgDetailData } from '@/features/org-detail';
import { deleteOrgImage, uploadOrgImage } from '@/lib/api/organizationImage';
import { useAuth } from '@/providers/AuthProvider';

export default function TenantAdminPage(): JSX.Element {
  const t = useTranslations('tenantAdmin');
  const { tokens, activeMembership, refreshMe } = useAuth();
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
  const [editOpen, setEditOpen] = useState(false);

  const handleImageUpload = useCallback(async (file: File) => {
    if (!tokens || !organizationId) return;
    await uploadOrgImage(tokens.access_token, organizationId, file);
    await refreshMe();
  }, [tokens, organizationId, refreshMe]);

  const handleImageRemove = useCallback(async () => {
    if (!tokens || !organizationId) return;
    await deleteOrgImage(tokens.access_token, organizationId);
    await refreshMe();
  }, [tokens, organizationId, refreshMe]);

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
    imageUrl: activeMembership.organization_image_url ?? null,
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
        onImageUpload={handleImageUpload}
        onImageRemove={handleImageRemove}
        tabBarActions={
          <Button variant="border" size="sm" onClick={() => { setEditOpen(true); }}>
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {t('editOrgButton')}
          </Button>
        }
      />
      <TenantOrgEditDialog
        organizationId={organizationId}
        currentName={activeMembership.organization_name}
        imageUrl={activeMembership.organization_image_url ?? null}
        open={editOpen}
        onOpenChange={setEditOpen}
        onImageUpload={handleImageUpload}
        onImageRemove={handleImageRemove}
        onSuccess={refreshMe}
      />
      <InviteMemberDialog
        organizationId={organizationId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </>
  );
}
