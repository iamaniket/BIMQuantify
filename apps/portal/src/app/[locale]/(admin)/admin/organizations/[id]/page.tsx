'use client';

import {
  Pause, Pencil, Play, Plus, Trash2,
} from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { use, useMemo, useState, type JSX } from 'react';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';

import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { MembersTable } from '@/features/admin/members/MembersTable';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import { OrgEditDialog } from '@/features/admin/organizations/OrgEditDialog';
import { OrgStatusBadge } from '@/features/admin/organizations/OrgStatusBadge';
import { SeatUsage } from '@/features/admin/organizations/SeatUsage';
import { useAdminOrganization } from '@/features/admin/organizations/useAdminOrganization';
import { useDeleteOrganization } from '@/features/admin/organizations/useDeleteOrganization';
import { useUpdateOrganization } from '@/features/admin/organizations/useUpdateOrganization';

type Props = {
  params: Promise<{ id: string }>;
};

export default function AdminOrganizationDetailPage({ params }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.detail');
  const router = useRouter();
  const { id } = use(params);

  const orgQuery = useAdminOrganization(id);
  const membersQuery = useOrgMembers(id);
  const auditQuery = useOrgAuditLog(id, { limit: 50 });
  const deleteMutation = useDeleteOrganization();
  const statusMutation = useUpdateOrganization();

  // Render breadcrumb with the real tenant name. Falls back to the static
  // "Tenant" crumb from AppHeaderRoute while the org is loading.
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
  const org = orgQuery.data;

  const handleDelete = (): void => {
    if (!window.confirm(t('confirmDelete', { name: org.name }))) return;
    deleteMutation.mutate(org.id, {
      onSuccess: () => {
        router.replace('/admin/organizations');
      },
    });
  };

  const isSuspended = org.status === 'suspended';
  const handleConfirmStatus = (): void => {
    statusMutation.mutate(
      {
        id: org.id,
        input: { status: isSuspended ? 'active' : 'suspended' },
      },
      {
        onSuccess: () => {
          setStatusConfirmOpen(false);
        },
      },
    );
  };

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={org.name}
        subtitle={org.schema_name}
        actions={
          <>
            <Button variant="border" onClick={() => { setEditOpen(true); }}>
              <Pencil className="mr-1 h-4 w-4" />
              {t('editButton')}
            </Button>
            <Button
              variant={isSuspended ? 'primary' : 'border'}
              onClick={() => { setStatusConfirmOpen(true); }}
            >
              {isSuspended ? (
                <Play className="mr-1 h-4 w-4" />
              ) : (
                <Pause className="mr-1 h-4 w-4" />
              )}
              {isSuspended ? t('reactivateButton') : t('suspendButton')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="mr-1 h-4 w-4" />
              {t('deleteButton')}
            </Button>
          </>
        }
        className={undefined}
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <OrgStatusBadge status={org.status} />
        <SeatUsage seatCountUsed={org.seat_count_used} seatLimit={org.seat_limit} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4">
          <TabsTrigger value="overview">{t('tabs.overview')}</TabsTrigger>
          <TabsTrigger value="members">{t('tabs.members')}</TabsTrigger>
          <TabsTrigger value="audit">{t('tabs.audit')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <CardHeader>
              <h3 className="text-body2 font-semibold">{t('overview.title')}</h3>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.created')}
                  </dt>
                  <dd className="text-body3">
                    {new Date(org.created_at).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.provisioned')}
                  </dt>
                  <dd className="text-body3">
                    {org.provisioned_at === null
                      ? '—'
                      : new Date(org.provisioned_at).toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.seatLimit')}
                  </dt>
                  <dd className="text-body3">
                    {org.seat_limit === null ? t('overview.unlimited') : org.seat_limit}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.seatUsed')}
                  </dt>
                  <dd className="text-body3">{org.seat_count_used}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="members">
          <div className="mb-3 flex justify-end">
            <Button onClick={() => { setInviteOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" />
              {t('members.inviteButton')}
            </Button>
          </div>
          {membersQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : membersQuery.isError ? (
            <p className="text-body3 text-error">{t('members.loadError')}</p>
          ) : (
            <MembersTable
              organizationId={org.id}
              members={membersQuery.data ?? []}
            />
          )}
        </TabsContent>

        <TabsContent value="audit">
          {auditQuery.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : auditQuery.isError ? (
            <p className="text-body3 text-error">{t('audit.loadError')}</p>
          ) : (
            <AuditLogTable entries={auditQuery.data ?? []} />
          )}
        </TabsContent>
      </Tabs>

      <OrgEditDialog organization={org} open={editOpen} onOpenChange={setEditOpen} />
      <InviteMemberDialog
        organizationId={org.id}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
      <ConfirmDialog
        open={statusConfirmOpen}
        onOpenChange={setStatusConfirmOpen}
        title={isSuspended ? t('reactivate.title') : t('suspend.title')}
        description={
          isSuspended
            ? t('reactivate.body', { name: org.name })
            : t('suspend.body', { name: org.name })
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
    </main>
  );
}
