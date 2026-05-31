'use client';

import { Pause, Pencil, Play, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { use, useCallback, useMemo, useState, type JSX } from 'react';

import { Button, ConfirmDialog, Skeleton } from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/shared/header/AppHeaderContext';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import { OrgEditDialog } from '@/features/admin/organizations/OrgEditDialog';
import { useAdminOrganization } from '@/features/admin/organizations/useAdminOrganization';
import { useDeleteOrganization } from '@/features/admin/organizations/useDeleteOrganization';
import { useUpdateOrganization } from '@/features/admin/organizations/useUpdateOrganization';
import { OrgDetailView } from '@/features/org-detail';
import type { OrgDetailData } from '@/features/org-detail';
import { deleteAdminOrgImage, uploadAdminOrgImage } from '@/lib/api/organizationImage';
import { useAuth } from '@/providers/AuthProvider';

type Props = {
  params: Promise<{ id: string }>;
};

export default function AdminOrganizationDetailPage({ params }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.detail');
  const router = useRouter();
  const { id } = use(params);

  const { tokens, refreshMe } = useAuth();
  const orgQuery = useAdminOrganization(id);
  const membersQuery = useOrgMembers(id);
  const auditQuery = useOrgAuditLog(id, { limit: 50 });
  const deleteMutation = useDeleteOrganization();
  const statusMutation = useUpdateOrganization();

  const handleImageUpload = useCallback(async (file: File) => {
    if (!tokens) return;
    await uploadAdminOrgImage(tokens.access_token, id, file);
    await orgQuery.refetch();
    await refreshMe();
  }, [tokens, id, orgQuery, refreshMe]);

  const handleImageRemove = useCallback(async () => {
    if (!tokens) return;
    await deleteAdminOrgImage(tokens.access_token, id);
    await orgQuery.refetch();
    await refreshMe();
  }, [tokens, id, orgQuery, refreshMe]);

  const orgName = orgQuery.data?.name;
  const crumbs = useMemo(
    () => (orgName === undefined
      ? null
      : [
        { label: 'Admin', href: '/admin/organizations' },
        { label: 'Tenants', href: '/admin/organizations' },
        { label: orgName, href: undefined },
      ]),
    [orgName],
  );
  useHeaderCrumbsOverride(crumbs);

  const [editOpen, setEditOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [statusConfirmOpen, setStatusConfirmOpen] = useState(false);

  if (orgQuery.isLoading) {
    return (
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="mb-6 h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-body3 text-error">{t('loadError')}</p>
      </main>
    );
  }
  const raw = orgQuery.data;

  const handleDelete = (): void => {
    if (!window.confirm(t('confirmDelete', { name: raw.name }))) return;
    deleteMutation.mutate(raw.id, {
      onSuccess: () => {
        router.replace('/admin/organizations');
      },
    });
  };

  const isSuspended = raw.status === 'suspended';
  const handleConfirmStatus = (): void => {
    statusMutation.mutate(
      {
        id: raw.id,
        input: { status: isSuspended ? 'active' : 'suspended' },
      },
      {
        onSuccess: () => {
          setStatusConfirmOpen(false);
        },
      },
    );
  };

  const org: OrgDetailData = {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    seatLimit: raw.seat_limit,
    seatCountUsed: raw.seat_count_used,
    imageUrl: raw.image_url ?? null,
    schemaName: raw.schema_name,
    createdAt: raw.created_at,
    provisionedAt: raw.provisioned_at,
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
        onDelete={handleDelete}
        onImageUpload={handleImageUpload}
        onImageRemove={handleImageRemove}
        heroActions={
          <div className="flex gap-2">
            <Button variant="border" size="sm" onClick={() => { setEditOpen(true); }}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {t('editButton')}
            </Button>
            <Button
              variant={isSuspended ? 'primary' : 'border'}
              size="sm"
              onClick={() => { setStatusConfirmOpen(true); }}
            >
              {isSuspended ? (
                <Play className="mr-1 h-3.5 w-3.5" />
              ) : (
                <Pause className="mr-1 h-3.5 w-3.5" />
              )}
              {isSuspended ? t('reactivateButton') : t('suspendButton')}
            </Button>
            <Button variant="destructive" size="sm" onClick={handleDelete}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              {t('deleteButton')}
            </Button>
          </div>
        }
      />
      <OrgEditDialog organization={raw} open={editOpen} onOpenChange={setEditOpen} />
      <InviteMemberDialog
        organizationId={raw.id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
      <ConfirmDialog
        open={statusConfirmOpen}
        onOpenChange={setStatusConfirmOpen}
        title={isSuspended ? t('reactivate.title') : t('suspend.title')}
        description={
          isSuspended
            ? t('reactivate.body', { name: raw.name })
            : t('suspend.body', { name: raw.name })
        }
        confirmLabel={
          isSuspended ? t('reactivate.confirm') : t('suspend.confirm')
        }
        cancelLabel={t('reactivate.cancel')}
        onConfirm={handleConfirmStatus}
        variant={isSuspended ? 'default' : 'destructive'}
        isPending={statusMutation.isPending}
        errorMessage={undefined}
      />
    </>
  );
}
