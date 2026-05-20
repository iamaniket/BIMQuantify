'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState, type JSX } from 'react';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@bimstitch/ui';

import { useHeaderCrumbsOverride } from '@/components/header/AppHeaderContext';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { useOrgAuditLog } from '@/features/admin/audit/useAuditLog';
import { InviteMemberDialog } from '@/features/admin/members/InviteMemberDialog';
import { MembersTable } from '@/features/admin/members/MembersTable';
import { useOrgMembers } from '@/features/admin/members/useOrgMembers';
import { OrgStatusBadge } from '@/features/admin/organizations/OrgStatusBadge';
import { SeatUsage } from '@/features/admin/organizations/SeatUsage';
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
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="mb-6 h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  // RLS / membership state: only render the page if the current active org
  // actually grants admin to this user. Switching to a non-admin tenant
  // sends the user back to /. The layout already gates initial mount but
  // the active org can change after mount via the sidebar switcher.
  if (!activeMembership.is_org_admin) {
    return (
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <p className="text-body3 text-error">{t('notAdmin')}</p>
      </main>
    );
  }

  return (
    <main className="px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={activeMembership.organization_name}
        subtitle={t('pageSubtitle')}
        actions={null}
        className={undefined}
      />

      <div className="mb-6 flex flex-wrap gap-3">
        <OrgStatusBadge status={activeMembership.organization_status} />
        <SeatUsage
          seatCountUsed={activeMembership.seat_count_used}
          seatLimit={activeMembership.seat_limit}
        />
      </div>

      <Tabs defaultValue="members">
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
                    {t('overview.name')}
                  </dt>
                  <dd className="text-body3">{activeMembership.organization_name}</dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.status')}
                  </dt>
                  <dd className="text-body3">
                    <OrgStatusBadge status={activeMembership.organization_status} />
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.seatLimit')}
                  </dt>
                  <dd className="text-body3">
                    {activeMembership.seat_limit === null
                      ? t('overview.unlimited')
                      : activeMembership.seat_limit}
                  </dd>
                </div>
                <div>
                  <dt className="text-caption text-foreground-tertiary">
                    {t('overview.seatUsed')}
                  </dt>
                  <dd className="text-body3">{activeMembership.seat_count_used}</dd>
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
              organizationId={organizationId}
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

      <InviteMemberDialog
        organizationId={organizationId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
      />
    </main>
  );
}
